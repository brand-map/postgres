---
outline: deep
---

# Transactions

### `transaction`

```typescript:norun
export enum IsolationLevel {
  // these are the only meaningful values in Postgres:
  // see https://www.postgresql.org/docs/11/sql-set-transaction.html
  Serializable = "SERIALIZABLE",
  RepeatableRead = "REPEATABLE READ",
  ReadCommitted = "READ COMMITTED",
  SerializableReadOnly = "SERIALIZABLE, READ ONLY",
  RepeatableReadReadOnly = "REPEATABLE READ, READ ONLY",
  ReadCommittedReadOnly = "READ COMMITTED, READ ONLY",
  SerializableReadOnlyDeferrable = "SERIALIZABLE, READ ONLY, DEFERRABLE"
}
export async function transaction<T, M extends IsolationLevel>(
  transactionClientOrQueryable: Queryable | TransactionClient<IsolationSatisfying<M>>,
  isolationLevel: M,
  callback: (client: TransactionClient<IsolationSatisfying<M>>) => Promise<T>
): Promise<T>
```

The `transaction` helper takes a `pg.Pool` / connected `pg.Client` or a Bun SQL client (`new SQL(...)`), an isolation mode, and an `async` callback function (it can also take an existing `TransactionClient` instead, but [we'll cover that later](#transaction-sharing)). It then proceeds as follows:

- Issue a `BEGIN TRANSACTION`.
- Call the callback, passing it a database client (checked out from the pool, if that's what was given).
- If a serialization error is thrown, try again after a [configurable](/runtime-configuration#run-time-configuration) random delay, a [configurable](/runtime-configuration#run-time-configuration) number of times.
- If any other error is thrown, issue a `ROLLBACK`, release the database client (if it's one it checked out earlier), and re-throw the error.
- Otherwise `COMMIT` the transaction, release the database client (if it's one it checked out earlier), and return the callback's result.

As is implied above, for `REPEATABLE READ` or `SERIALIZABLE` isolation modes the callback could be called several times. It's therefore important that it doesn't have any non-database-related side-effects (i.e. don't, say, bill your customer's credit card from this function).

We already saw [one `transaction` example](/overview#transactions). Here's another, adapted from [CockroachDB's write-up on `SERIALIZABLE`](https://www.cockroachlabs.com/docs/stable/demo-serializable.html).

We have a table of `doctors`, and a table of their assigned `shifts`.

```sql
CREATE TABLE "doctors"
( "id" SERIAL PRIMARY KEY
, "name" TEXT NOT NULL );

CREATE TABLE "shifts"
( "day" DATE NOT NULL
, "doctorId" INTEGER NOT NULL REFERENCES "doctors"("id")
, PRIMARY KEY ("day", "doctorId") );
```

We populate those tables with two doctors and two days' shifts:

```typescript
await db
  .insert("doctors", [
    { id: 1, name: "Annabel" },
    { id: 2, name: "Brian" },
  ])
  .run(pool);

await db
  .insert("shifts", [
    { day: "2020-12-24", doctorId: 1 },
    { day: "2020-12-24", doctorId: 2 },
    { day: "2020-12-25", doctorId: 1 },
    { day: "2020-12-25", doctorId: 2 },
  ])
  .run(pool);
```

The important business logic is that there must always be _at least one doctor_ on shift. Now let's say both doctors happen at the same moment to request leave for 25 December.

```typescript
const requestLeaveForDoctorOnDay = async (doctorId: number, day: db.DateString) =>
  db.transaction(pool, db.IsolationLevel.Serializable, async (transactionClient) => {
    const otherDoctorsOnShift = await db
      .count("shifts", {
        doctorId: db.sql`${db.self} != ${db.param(doctorId)}`,
        day,
      })
      .run(transactionClient);
    if (otherDoctorsOnShift === 0) return false;

    await db.deletes("shifts", { day, doctorId }).run(transactionClient);
    return true;
  });

const [leaveBookedForAnnabel, leaveBookedForBrian] = await Promise.all([
  // in practice, these requests would come from different front-ends
  requestLeaveForDoctorOnDay(1, "2020-12-25"),
  requestLeaveForDoctorOnDay(2, "2020-12-25"),
]);

console.log(`Leave booked for:
  Annabel – ${leaveBookedForAnnabel}
  Brian – ${leaveBookedForBrian}`);
```

Expanding the results, we see that one of the requests is retried and then fails — as it must to retain one doctor on shift — thanks to the `SERIALIZABLE` isolation. `REPEATABLE READ`, which is one isolation level weaker, wouldn't help here.

#### Transaction isolation shortcuts

To help save keystrokes and line noise, there is a family of transaction shortcut functions named after each isolation mode. For example, instead of:

```typescript:noresult
const result = await db.transaction(pool, db.IsolationLevel.Serializable, async transactionClient => { /* ... */ });
```

You can use the equivalent:

```typescript:noresult
const result = await db.serializable(pool, async transactionClient => { /* ... */ });
```

#### `IsolationSatisfying` generic

```typescript:norun
export type IsolationSatisfying<T extends IsolationLevel> = {
  [IsolationLevel.Serializable]: IsolationLevel.Serializable;
  [IsolationLevel.RepeatableRead]: IsolationSatisfying<IsolationLevel.Serializable> | IsolationLevel.RepeatableRead;
  /* ... */
}[T];

export type TxnClientForSerializable = TransactionClient<IsolationSatisfying<IsolationLevel.Serializable>>;
export type TxnClientForRepeatableRead = TransactionClient<IsolationSatisfying<IsolationLevel.RepeatableRead>>;
/* ... */
```

If you find yourself passing transaction clients around, you may find the `IsolationSatisfying` generic useful. For example, if you type a `transactionClient` argument to a function as `IsolationSatisfying<IsolationLevel.RepeatableRead>` — probably by using the alias type `TxnClientForRepeatableRead` — you can call it with a client having `IsolationLevel.Serializable` or `IsolationLevel.RepeatableRead` but not `IsolationLevel.ReadCommitted`.

#### Transaction sharing

A snag you might have encountered when using Postgres transactions is that, since transactions can't be nested, it's fiddly to break out SQL operations with cross-cutting isolation requirements into self-contained functions.

Recall the transaction example we began with: a [money transfer between two bank accounts](/overview#transactions). We do this within a transaction, because we need atomicity: we must ensure that either balance A is increased _and_ balance B is correspondingly reduced, or that neither thing happens.

But what if we want to combine some other operations within the same database transaction? Say we want to make two transfers, A to B and A to C, or have both fail. The `transferMoney` function we originally wrote uses a transaction helper to `BEGIN` and `COMMIT` its own transaction every time, so we can't just call it twice.

For this reason, the `transaction` function — and its isolation-level shortcuts — can be passed either a plain queryable client (`pg.Pool`, `pg.Client`, or Bun SQL), in which case they manage a transaction as decribed above, or an existing `TransactionClient`. If they're passed an existing `TransactionClient`, they do no more than call the provided callback function with the provided client on the spot.

Let's see how this helps. We'll modify the `transferMoney` function to take a pool or transaction client as its last argument, and pass that straight to the `serializable` transaction function. (Note that we _could_ give this last argument a default value of `pool`, but I find that way it's too easy to accidentally issue queries outside of transactions).

With that done, we can now use `transferMoney` both for individual transfers, without worrying about transactions, and in combination with other operations, by taking charge of the transaction ourselves:

```typescript
const [accountA, accountB, accountC] = await db.insert("bankAccounts", [{ balance: 50 }, { balance: 50 }, { balance: 50 }]).run(pool);

const transferMoney = (sendingAccountId: number, receivingAccountId: number, amount: number, txnClientOrPool: typeof pool | db.TxnClientForSerializable) =>
  db.serializable(txnClientOrPool, (transactionClient) =>
    Promise.all([
      db.update("bankAccounts", { balance: db.sql`${db.self} - ${db.param(amount)}` }, { id: sendingAccountId }).run(transactionClient),
      db.update("bankAccounts", { balance: db.sql`${db.self} + ${db.param(amount)}` }, { id: receivingAccountId }).run(transactionClient),
    ]),
  );

// single transfer, as before (but passing in `pool`)
try {
  await transferMoney(accountA.id, accountB.id, 60, pool);
} catch (err: any) {
  console.log(err.message, "/", err.detail);
}

// multiple transfers, passing in an external transaction
try {
  await db.serializable(pool, (transactionClient) =>
    Promise.all([transferMoney(accountA.id, accountB.id, 40, transactionClient), transferMoney(accountA.id, accountC.id, 40, transactionClient)]),
  );
} catch (err: any) {
  console.log(err.message, "/", err.detail);
}

await db.select("bankAccounts", { id: dc.isIn([accountA.id, accountB.id, accountC.id]) }).run(pool);
```

If you expand the results you'll see that both transactions fail, as intended.

Happily, the type system will prevent us from trying to pass `transferMoney` a database client associated with an insufficiently isolated transaction. If we were to substitute `db.serializable` with `db.repeatableRead` inside the second `try` block, TypeScript would complain.

=> pgErrors.ts export function isDatabaseError(err: Error, ...types: (keyof typeof pgErrors)[]) {
