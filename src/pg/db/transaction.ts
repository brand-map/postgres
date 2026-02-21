import * as pg from "pg"

import { getConfig } from "../../shared/config"
import { sql, raw } from "../../shared/db/core"
import { isDatabaseError } from "../../shared/db/postgres-errors"
import { wait } from "../../shared/utils"

// these are the only meaningful values in Postgres:
// https://www.postgresql.org/docs/18/sql-set-transaction.html
export const Serializable = "SERIALIZABLE"
export type Serializable = typeof Serializable

export const RepeatableRead = "REPEATABLE READ"
export type RepeatableRead = typeof RepeatableRead

export const ReadCommitted = "READ COMMITTED"
export type ReadCommitted = typeof ReadCommitted

export const SerializableReadOnly = "SERIALIZABLE, READ ONLY"
export type SerializableReadOnly = typeof SerializableReadOnly

export const RepeatableReadReadOnly = "REPEATABLE READ, READ ONLY"
export type RepeatableReadReadOnly = typeof RepeatableReadReadOnly

export const ReadCommittedReadOnly = "READ COMMITTED, READ ONLY"
export type ReadCommittedReadOnly = typeof ReadCommittedReadOnly

export const SerializableReadOnlyDeferrable = "SERIALIZABLE, READ ONLY, DEFERRABLE"
export type SerializableReadOnlyDeferrable = typeof SerializableReadOnlyDeferrable

export const IsolationLevel = {
  Serializable,
  RepeatableRead,
  ReadCommitted,
  SerializableReadOnly,
  RepeatableReadReadOnly,
  ReadCommittedReadOnly,
  SerializableReadOnlyDeferrable
} as const

export type IsolationLevel = Serializable | RepeatableRead | ReadCommitted | SerializableReadOnly | RepeatableReadReadOnly | ReadCommittedReadOnly | SerializableReadOnlyDeferrable

export type IsolationSatisfying<T extends IsolationLevel> = {
  [Serializable]: Serializable
  [RepeatableRead]: IsolationSatisfying<Serializable> | RepeatableRead
  [ReadCommitted]: IsolationSatisfying<RepeatableRead> | ReadCommitted
  [SerializableReadOnly]: IsolationSatisfying<Serializable> | SerializableReadOnly
  [RepeatableReadReadOnly]: IsolationSatisfying<SerializableReadOnly> | IsolationSatisfying<RepeatableRead> | RepeatableReadReadOnly
  [ReadCommittedReadOnly]: IsolationSatisfying<RepeatableReadReadOnly> | IsolationSatisfying<ReadCommitted> | ReadCommittedReadOnly
  [SerializableReadOnlyDeferrable]: IsolationSatisfying<SerializableReadOnly> | SerializableReadOnlyDeferrable
}[T]

export interface TransactionClient<T extends IsolationLevel> extends pg.PoolClient {
  __bmPostgres?: { isolationLevel: T; transactionId: number }
}

export type TransactionClientForSerializable = TransactionClient<IsolationSatisfying<Serializable>>
export type TransactionClientForRepeatableRead = TransactionClient<IsolationSatisfying<RepeatableRead>>
export type TransactionClientForReadCommitted = TransactionClient<IsolationSatisfying<ReadCommitted>>
export type TransactionClientForSerializableReadOnly = TransactionClient<IsolationSatisfying<SerializableReadOnly>>
export type TransactionClientForRepeatableReadReadOnly = TransactionClient<IsolationSatisfying<RepeatableReadReadOnly>>
export type TransactionClientForReadCommittedReadOnly = TransactionClient<IsolationSatisfying<ReadCommittedReadOnly>>
export type TransactionClientForSerializableReadOnlyDeferrable = TransactionClient<IsolationSatisfying<SerializableReadOnlyDeferrable>>

type Queryable = pg.ClientBase | pg.Pool

function typeofQueryable(queryable: Queryable) {
  if (queryable instanceof pg.Pool) {
    return "pool"
  }

  if (queryable instanceof pg.Client) {
    return "client"
  }

  if (Object.hasOwn(pg, "native") && Object.prototype.propertyIsEnumerable.call(pg, "native") && pg.native) {
    if (queryable instanceof pg.native.Pool) {
      return "pool"
    }

    if (queryable instanceof pg.native.Client) {
      return "pool"
    }
  }

  // for pg < 8, and sometimes in 8.x for reasons that aren't clear, all the
  // instanceof checks fail: then we resort to testing for the private variable
  // `_connected`, which is defined (as a boolean) on clients (pure JS and
  // native) but not on pools

  if ((queryable as any)._connected === undefined) {
    return "pool"
  }

  return "client"
}

let transactionSequence = 0

/**
 * Provide a database client to the callback, whose queries are then wrapped in
 * a database transaction. The transaction is committed, retried, or rolled back
 * as appropriate.
 * @param transactionClientOrQueryable The `pg.Pool` from which to check out a client,
 * a plain client, or an existing transaction client to be passed through
 * @param isolationLevel The desired isolation level (e.g.
 * `IsolationLevel.Serializable`)
 * @param callback A callback function that runs queries on the client provided
 * to it
 */
export async function transaction<T, M extends IsolationLevel>(
  transactionClientOrQueryable: Queryable | TransactionClient<IsolationSatisfying<M>>,
  isolationLevel: M,
  callback: (client: TransactionClient<IsolationSatisfying<M>>) => Promise<T>
): Promise<T> {
  if (Object.hasOwn(transactionClientOrQueryable, "__bmPostgres")) {
    // if transactionClientOrQueryable is a TransactionClient, just pass it through
    return callback(transactionClientOrQueryable as TransactionClient<IsolationSatisfying<M>>)
  }

  if (transactionSequence >= Number.MAX_SAFE_INTEGER - 1) {
    transactionSequence = 0 // wrap around
  }

  const transactionId = transactionSequence++
  const clientIsOurs = typeofQueryable(transactionClientOrQueryable) === "pool"
  const transactionClient = (clientIsOurs ? await transactionClientOrQueryable.connect() : transactionClientOrQueryable) as TransactionClient<M>

  transactionClient.__bmPostgres = { isolationLevel, transactionId }

  const config = getConfig()
  const { transactionListener } = config
  const maxAttempts = config.transactionAttemptsMax
  const { min, max } = config.transactionRetryDelay

  try {
    for (let attempt = 1; ; attempt++) {
      try {
        if (attempt > 1 && transactionListener) {
          transactionListener(`Retrying transaction, attempt ${attempt} of ${maxAttempts}`, transactionId)
        }

        await sql`START TRANSACTION ISOLATION LEVEL ${raw(isolationLevel)}`.run(transactionClient)
        const result = await callback(transactionClient as TransactionClient<IsolationSatisfying<M>>)
        await sql`COMMIT`.run(transactionClient)

        return result
      } catch (err: any) {
        await sql`ROLLBACK`.run(transactionClient)

        // on trapping the following two rollback error codes, see:
        // https://www.postgresql.org/message-id/1368066680.60649.YahooMailNeo@web162902.mail.bf1.yahoo.com
        // this is also a good read:
        // https://www.enterprisedb.com/blog/serializable-postgresql-11-and-beyond

        if (isDatabaseError(err, "TransactionRollback_SerializationFailure", "TransactionRollback_DeadlockDetected")) {
          if (attempt < maxAttempts) {
            const delayBeforeRetry = Math.round(min + (max - min) * Math.random())
            if (transactionListener) {
              transactionListener(`Transaction rollback (code ${err.code}) on attempt ${attempt} of ${maxAttempts}, retrying in ${delayBeforeRetry}ms`, transactionId)
            }
            await wait(delayBeforeRetry)
          } else {
            if (transactionListener) {
              transactionListener(`Transaction rollback (code ${err.code}) on attempt ${attempt} of ${maxAttempts}, giving up`, transactionId)
            }
            throw err
          }
        } else {
          throw err
        }
      }
    }
  } finally {
    delete transactionClient.__bmPostgres
    if (clientIsOurs) {
      transactionClient.release()
    }
  }
}

/**
 * Shortcut for `transaction` with isolation level `Serializable`.
 * @param transactionClientOrQueryable The `pg.Pool` from which to check out a client,
 * a plain client, or an existing transaction client to be passed through
 * @param callback A callback function that runs queries on the client provided
 * to it
 */
export async function serializable<T>(
  transactionClientOrQueryable: Queryable | TransactionClientForSerializable,
  callback: (client: TransactionClientForSerializable) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.Serializable, callback)
}

/**
 * Shortcut for `transaction` with isolation level `RepeatableRead`.
 * @param transactionClientOrQueryable The `pg.Pool` from which to check out a client,
 * a plain client, or an existing transaction client to be passed through
 * @param callback A callback function that runs queries on the client provided
 * to it
 */
export async function repeatableRead<T>(
  transactionClientOrQueryable: Queryable | TransactionClientForRepeatableRead,
  callback: (client: TransactionClientForRepeatableRead) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.RepeatableRead, callback)
}

/**
 * Shortcut for `transaction` with isolation level `ReadCommitted`.
 * @param transactionClientOrQueryable The `pg.Pool` from which to check out a client,
 * a plain client, or an existing transaction client to be passed through
 * @param callback A callback function that runs queries on the client provided
 * to it
 */
export async function readCommitted<T>(
  transactionClientOrQueryable: Queryable | TransactionClientForReadCommitted,
  callback: (client: TransactionClientForReadCommitted) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.ReadCommitted, callback)
}

/**
 * Shortcut for `transaction` with isolation level `SerializableReadOnly`.
 * @param transactionClientOrQueryable The `pg.Pool` from which to check out a client,
 * a plain client, or an existing transaction client to be passed through
 * @param callback A callback function that runs queries on the client provided
 * to it
 */
export async function serializableRO<T>(
  transactionClientOrQueryable: Queryable | TransactionClientForSerializableReadOnly,
  callback: (client: TransactionClientForSerializableReadOnly) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.SerializableReadOnly, callback)
}

/**
 * Shortcut for `transaction` with isolation level `RepeatableReadReadOnly`.
 * @param transactionClientOrQueryable The `pg.Pool` from which to check out a client,
 * a plain client, or an existing transaction client to be passed through
 * @param callback A callback function that runs queries on the client provided
 * to it
 */
export async function repeatableReadRO<T>(
  transactionClientOrQueryable: Queryable | TransactionClientForRepeatableReadReadOnly,
  callback: (client: TransactionClientForRepeatableReadReadOnly) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.RepeatableReadReadOnly, callback)
}

/**
 * Shortcut for `transaction` with isolation level `ReadCommittedReadOnly`.
 * @param transactionClientOrQueryable The `pg.Pool` from which to check out a client,
 * a plain client, or an existing transaction client to be passed through
 * @param callback A callback function that runs queries on the client provided
 * to it
 */
export async function readCommittedRO<T>(
  transactionClientOrQueryable: Queryable | TransactionClientForReadCommittedReadOnly,
  callback: (client: TransactionClientForReadCommittedReadOnly) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.ReadCommittedReadOnly, callback)
}

/**
 * Shortcut for `transaction` with isolation level `SerializableReadOnlyDeferrable`.
 * @param transactionClientOrQueryable The `pg.Pool` from which to check out a client,
 * a plain client, or an existing transaction client to be passed through
 * @param callback A callback function that runs queries on the client provided
 * to it
 */
export async function serializableRODeferrable<T>(
  transactionClientOrQueryable: Queryable | TransactionClientForSerializableReadOnlyDeferrable,
  callback: (client: TransactionClientForSerializableReadOnlyDeferrable) => Promise<T>
) {
  return transaction(transactionClientOrQueryable, IsolationLevel.SerializableReadOnlyDeferrable, callback)
}
