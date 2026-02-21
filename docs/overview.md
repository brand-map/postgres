---
outline: deep
---

# Overview

## What does it do?

To achieve this aim, @brand-map/postgres does these five things:

- **Typescript schema** &nbsp; A command-line tool speaks to your Postgres database and writes up a detailed TypeScript schema for every table. This is just a means to an end: it enables the next three things in this list. [Show me »](#typescript-schema)

- **Arbitrary SQL** &nbsp; Simple building blocks help you write arbitrary SQL using [tagged templates](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#Tagged_templates), and manually apply the right types to what goes in and what comes back. [Show me »](#arbitrary-sql)

- **Everyday CRUD** &nbsp; Shortcut functions produce everyday [CRUD](https://en.wikipedia.org/wiki/Create,_read,_update_and_delete) queries with no fuss and no surprises, fully and automatically typed. [Show me »](#everyday-crud)

- **JOINs as nested JSON** &nbsp; Nested shortcut calls generate [`LATERAL JOIN`](https://www.postgresql.org/docs/12/queries-table-expressions.html#id-1.5.6.6.5.10.2) queries, resulting in arbitrarily complex nested JSON structures, still fully and automatically typed. [Show me »](#joins-as-nested-json)

- **Transactions** &nbsp; Transaction helper functions assist in managing and retrying transactions. [Show me »](#transactions)

### How does that look?

#### Typescript schema

**A command-line tool speaks to your Postgres database and writes up a detailed TypeScript schema for every table.**

Take this ultra-simple SQL schema for a single table, `authors`:

```sql
CREATE TABLE "authors"
( "id" SERIAL PRIMARY KEY
, "name" TEXT NOT NULL
, "isLiving" BOOLEAN );
```

We run `bunx @brand-map/postgres` to generate a file named `brand-map-postgres.schema.d.ts`, including table definitions like this one:

```typescript:norun
export namespace authors {
  export type Table = 'authors';
  export interface Selectable {
    id: number;
    name: string;
    isLiving: boolean | null;
  }
  export interface Whereable {
    id?: number | db.Parameter<number> | db.SQLFragment /* | ... etc ... */;
    name?: string | db.Parameter<string> | db.SQLFragment /* | ... etc ... */;
    isLiving?: boolean | db.Parameter<boolean> | db.SQLFragment /* | ... etc ... */;
  }
  export interface Insertable {
    id?: number | db.Parameter<number> | db.DefaultType | db.SQLFragment;
    name: string | db.Parameter<string> | db.SQLFragment;
    isLiving?: boolean | db.Parameter<boolean> | null | db.DefaultType | db.SQLFragment;
  }
  export interface Updatable {
    id?: number | db.Parameter<number> | db.DefaultType | db.SQLFragment /* | ... etc ... */;
    name?: string | db.Parameter<string> | db.SQLFragment /* | ... etc ... */;
    isLiving?: boolean | db.Parameter<boolean> | null | db.DefaultType | db.SQLFragment /* | ... etc ... */;
  }
  /* ... etc ... */
}
```

The type names are, I hope, reasonably self-explanatory. `authors.Selectable` is what I'll get back from a `SELECT` query on this table. `authors.Whereable` is what I can use in a `WHERE` condition: everything's optional, and I can include arbitrary SQL. `authors.Insertable` is what I can `INSERT`: it's similar to the `Selectable`, but any fields that are `NULL`able and/or have `DEFAULT` values are allowed to be missing, `NULL` or `DEFAULT`. `authors.Updatable` is what I can `UPDATE` the table with: like what I can `INSERT`, but all columns are optional: it's (roughly) a `Partial<authors.Insertable>`.

`brand-map-postgres.schema.d.ts` includes some other types that get used internally, including handy type mappings like this one:

```typescript:norun
export type SelectableForTable<T extends Table> = {
  authors: authors.Selectable;
  books: books.Selectable;
  tags: tags.Selectable;
  /* ... */
}[T];
```

@brand-map/postgres supports tables, foreign tables, views and materialized views. It understands enumerated types: `CREATE TYPE "size" AS ENUM ('big', 'small');` comes to TypeScript as `'big' | 'small'`. And it lets you define the TypeScript treatment of [domain types](https://www.postgresql.org/docs/current/domains.html) and user-defined types too.

[Tell me more about the command line tool »](/getting-started)

#### Arbitrary SQL

**Simple building blocks help you write arbitrary SQL using [tagged templates](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#Tagged_templates), and manually apply the right types to what goes in and what comes back.**

Let's insert something into that `authors` table for which we just generated the types. We'll write the SQL query ourselves, to show how that works (though we'll see an easier way [in the next section](#everyday-crud)):

```typescript
const author: s.authors.Insertable = {
    name: "Gabriel Garcia Marquez",
    isLiving: false
  },
  [insertedAuthor] = await db.sql<s.authors.SQL, s.authors.Selectable[]>`
      INSERT INTO ${"authors"} (${db.cols(author)})
      VALUES (${db.vals(author)}) RETURNING *`.run(pool)
```

We apply the appropriate type to the object we're trying to insert (`s.authors.Insertable`), giving us type-checking and autocompletion on that object. And we specify both which types are allowed as interpolated values in the template string (`s.authors.SQL`) and what type is going to be returned (`s.authors.Selectable[]`) when the query runs.

We also use the [`cols` and `vals` helper functions](/sql-and-fragments#cols-and-vals). These compile, respectively, to the object's keys (which are the column names) and query placeholders (`$1`, `$2`, ...) for the corresponding values.

_You can click 'Explore types' above to open the code in an embedded Monaco (VS Code) editor, so you can check those typings for yourself._

[Tell me more about writing arbitrary SQL »](/sql-and-fragments#sql-tagged-template-strings)

#### Everyday CRUD

**Shortcut functions produce everyday [CRUD](https://en.wikipedia.org/wiki/Create,_read,_update_and_delete) queries with no fuss and no surprises, fully and automatically typed.**

So — writing SQL with @brand-map/postgres is nicer than constructing a query and all its input and output types from scratch. But for a totally bog-standard CRUD query like the `INSERT` above, it still involves quite a lot of boilerplate.

To eliminate the boilerplate, @brand-map/postgres supplies some simple functions to generate these sorts of queries, fully and automatically typed.

Let's use one of them — `insert` — to add two more authors:

```typescript
const [doug, janey] = await db
  .insert("authors", [
    { name: "Douglas Adams", isLiving: false },
    { name: "Jane Austen", isLiving: false }
  ])
  .run(pool)
```

The `insert` shortcut accepts a single `Insertable` or an `Insertable[]` array, and correspondingly returns a single [`JSONSelectable`](/joins-and-shortcuts#jsonselectable) or a `JSONSelectable[]` array. Since we specified `'authors'` as the first argument here, and an array as the second, input and output will be checked and auto-completed as `authors.Insertable[]` and `authors.JSONSelectable[]` respectively.

_Again, click 'Explore types' to play around and check those typings._

In addition to `insert`, there are shortcuts for `select` (plus `selectOne`, `selectExactlyOne`, and simple aggregates such as `count` and `sum`), and for `update`, `upsert`, `delete` and `truncate`.

[Tell me more about the shortcut functions »](/joins-and-shortcuts#shortcut-functions-and-lateral-joins)

#### JOINs as nested JSON

**Nested shortcut calls generate [LATERAL JOIN](https://www.postgresql.org/docs/12/queries-table-expressions.html#id-1.5.6.6.5.10.2) queries, resulting in arbitrarily complex nested JSON structures, still fully and automatically typed.**

CRUD is our bread and butter, but the power of SQL is in the `JOIN`s. Postgres has powerful JSON features than can deliver sensibly-structured `JOIN` results with minimal post-processing: `json_agg`, `json_build_object`, and so on. @brand-map/postgres builds on these.

To demonstrate, let's say that `authors` have `books` and `books` have `tags`, adding two new tables to our simple schema:

```sql
CREATE TABLE "books"
( "id" SERIAL PRIMARY KEY
, "authorId" INTEGER NOT NULL REFERENCES "authors"("id")
, "title" TEXT
, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now() );

CREATE TABLE "tags"
( "tag" TEXT NOT NULL
, "bookId" INTEGER NOT NULL REFERENCES "books"("id") ON DELETE CASCADE );

CREATE UNIQUE INDEX "tagsUniqueIdx" ON "tags"("tag", "bookId");
```

And let's say I want to show a list of books, each with its (one) author and (many) associated tags. We could knock up a manual query for this, of course, but [it gets quite hairy](/joins-and-shortcuts#manual-joins-using-postgres-json-features). The `select` shortcut has an option called `lateral` that can nest other `select` queries and do it for us.

Let's try it:

```typescript
const bookAuthorTags = await db
  .select("books", db.all, {
    lateral: {
      author: db.selectExactlyOne("authors", { id: db.parent("authorId") }),
      tags: db.select("tags", { bookId: db.parent("id") })
    }
  })
  .run(pool)
```

This generates an efficient three-table `LATERAL JOIN` that returns a nested JSON structure directly from the database. Every nested element is again fully and automatically typed.

_Again, you can click 'Explore types' above to open the code in an embedded Monaco (VS Code) editor, so you can check those typings for yourself._

We can of course extend this to deeper nesting (e.g. query each author, with their books, with their tags); to self-joins (of a table with itself, e.g. employees to their managers in the same `employees` table); and to joins on relationships other than foreign keys (e.g. joining the nearest _N_ somethings using the PostGIS `<->` distance operator).

[Tell me more about nested `select` queries »](/joins-and-shortcuts#lateral-and-alias)

#### Transactions

**Transaction helper functions assist in managing and retrying transactions.**

Transactions are where I've found traditional ORMs like TypeORM and Sequelize most footgun-prone. @brand-map/postgres is always explicit about what client or pool is running your query — hence that `pool` argument in all our examples so far.

@brand-map/postgres also offers simple transaction helpers that handle issuing a SQL `ROLLBACK` on error, releasing the database client in a `finally` clause, and automatically retrying queries in case of serialization failures. There's one for each isolation level (`SERIALIZABLE`, `REPEATABLE READ`, and so on), and they look like this:

```typescript:noresult
const result = await db.serializable(pool, async transactionClient => {
  /* queries here use transactionClient instead of pool */
});
```

For instance, take this `bankAccounts` table:

```sql
CREATE TABLE "bankAccounts"
( "id" SERIAL PRIMARY KEY
, "balance" INTEGER NOT NULL DEFAULT 0 CHECK ("balance" >= 0) );
```

We can use the transaction helpers like so:

```typescript
const [accountA, accountB] = await db.insert("bankAccounts", [{ balance: 50 }, { balance: 50 }]).run(pool)

const transferMoney = (sendingAccountId: number, receivingAccountId: number, amount: number) =>
  db.serializable(pool, transactionClient =>
    Promise.all([
      db.update("bankAccounts", { balance: db.sql`${db.self} - ${db.param(amount)}` }, { id: sendingAccountId }).run(transactionClient),
      db.update("bankAccounts", { balance: db.sql`${db.self} + ${db.param(amount)}` }, { id: receivingAccountId }).run(transactionClient)
    ])
  )

try {
  const [[updatedAccountA], [updatedAccountB]] = await transferMoney(accountA.id, accountB.id, 60)
} catch (err: any) {
  console.log(err.message, "/", err.detail)
}
```

Finally, @brand-map/postgres provides a set of hierarchical isolation types so that, for example, if you type a `transactionClient` argument to a function as `TransactionClientForRepeatableRead`, you can call it with `IsolationLevel.Serializable` or `IsolationLevel.RepeatableRead` but not `IsolationLevel.ReadCommitted`.

[Tell me more about the transaction functions »](/transactions#transaction)

### Why does it do those things?

It is a truth universally acknowledged that [ORMs aren't very good](https://en.wikipedia.org/wiki/Object-relational_impedance_mismatch). JavaScript and TypeScript ORMs are perhaps even worse than the average. One @brand-map/postgres user [described a popular TypeScript ORM](https://news.ycombinator.com/item?id=27556821) as "full of broken magic under the hood", which nicely captures what originally motivated me to write this library.

I like SQL, and Postgres especially. In my experience, abstractions that obscure the underlying SQL, or that prioritise ease of switching to another database tomorrow over effective use of _this_ database _today_, are a source of misery.

I've also come to love strongly typed languages, and TypeScript in particular. VS Code's type checking and autocomplete speed development, prevent bugs, and simplify refactoring. Especially when they _just happen_, they bring joy. But, traditionally, talking to the database is a place where they really don't _just happen_.

@brand-map/postgres aims to fix that.

If it interests you, there's a whole other [repository about how @brand-map/postgres came about](https://github.com/jawj/mostly-ormless).

### What doesn't it do?

@brand-map/postgres doesn't handle schema migrations. Other tools can help you with this: check out [dbmate](https://github.com/amacneil/dbmate), for instance.

It also doesn't manage database clients for you, as some ORMs do. You can use either `pg` or Bun SQL directly.

For `pg`, a setup might look like this:

```typescript:norun
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', err => console.error(err));  // don't let a pg restart kill your app

export default pool;
```

For Bun SQL, a similar setup is:

```typescript:norun
import { SQL } from "bun";

const sql = new SQL(process.env.DATABASE_URL!);

export default sql;
```

Finally, it won't tell you how to structure your code: @brand-map/postgres doesn't deal in the 'model' classes beloved of traditional ORMs, just (fully-typed) [POJOs](https://twitter.com/_ericelliott/status/831965087749533698?lang=en).
