---
outline: deep
---

# Joins And Shortcut Functions

### Manual joins using Postgres' JSON features

We can make use of Postgres' excellent JSON support to achieve a variety of `JOIN` queries. That's not unique to @brand-map/postgres, of course, but it may be helpful to consider a few example queries in this context.

Take this example, retrieving each book with its (single) author:

```typescript
type bookAuthorSQL = s.books.SQL | s.authors.SQL | "author";
type bookAuthorSelectable = s.books.Selectable & { author: s.authors.Selectable };

const query = db.sql<bookAuthorSQL, bookAuthorSelectable[]>`
  SELECT ${"books"}.*, to_jsonb(${"authors"}.*) as ${"author"}
  FROM ${"books"} JOIN ${"authors"} 
  ON ${"books"}.${"authorId"} = ${"authors"}.${"id"}`;

const bookAuthors = await query.run(pool);
```

Of course, we might also want the converse query, retrieving each author with their (many) books. This is also easy enough to arrange:

```typescript
type authorBooksSQL = s.authors.SQL | s.books.SQL;
type authorBooksSelectable = s.authors.Selectable & { books: s.books.Selectable[] };

const query = db.sql<authorBooksSQL, authorBooksSelectable[]>`
  SELECT ${"authors"}.*, jsonb_agg(${"books"}.*) AS ${"books"}
  FROM ${"authors"} JOIN ${"books"} 
  ON ${"authors"}.${"id"} = ${"books"}.${"authorId"}
  GROUP BY ${"authors"}.${"id"}`;

const authorBooks = await query.run(pool);
```

Note that if you want to include authors with no books, you need a `LEFT JOIN` in this query, and then you'll also want to fix the annoying [`[null]` array results `jsonb_agg` will return for those authors](https://stackoverflow.com/questions/24155190/postgresql-left-join-json-agg-ignore-remove-null).

Rather than do it that way, though, we can achieve the same result using a [`LATERAL JOIN`](https://medium.com/kkempin/postgresqls-lateral-join-bfd6bd0199df) instead:

```typescript
type authorBooksSQL = s.authors.SQL | s.books.SQL;
type authorBooksSelectable = s.authors.Selectable & { books: s.books.Selectable[] };

const query = db.sql<authorBooksSQL, authorBooksSelectable[]>`
  SELECT ${"authors"}.*, bq.* 
  FROM ${"authors"} LEFT JOIN LATERAL (
    SELECT coalesce(json_agg(${"books"}.*), '[]') AS ${"books"}
    FROM ${"books"}
    WHERE ${"books"}.${"authorId"} = ${"authors"}.${"id"}
  ) bq ON true`;

const authorBooks = await query.run(pool);
```

Lateral joins of this sort are very flexible, and can be nested multiple levels deep — but can quickly become quite hairy in that case. The [`select` shortcut function](#select-selectone-and-selectexactlyone) and its [`lateral` option](#lateral-and-alias) can make this much less painful.

### Shortcut functions and lateral joins

A key contribution of @brand-map/postgres is a set of simple shortcut functions that make everyday [CRUD](https://en.wikipedia.org/wiki/Create,_read,_update_and_delete) queries extremely easy to work with. Furthermore, the `select` shortcut can be nested in order to generate [LATERAL JOIN](https://www.postgresql.org/docs/12/queries-table-expressions.html#id-1.5.6.6.5.10.2) queries, resulting in arbitrarily complex nested JSON structures with inputs and outputs that are still fully and automatically typed.

The shortcut functions make heavy use of Postgres' JSON support, and their return values are thus [`JSONSelectable`](#jsonselectable)s rather than the plain `Selectable`s you'd get back from a manual query.

=> shortcuts.ts /_ === insert === _/

#### `insert`

The `insert` shortcut inserts one or more rows in a table, and returns them with any `DEFAULT` or generated values filled in. It takes a `Table` name and the corresponding `Insertable` or `Insertable[]`, and returns the corresponding `JSONSelectable` or `JSONSelectable[]` (subject to the options described below).

The optional `options` argument has two keys.

- `returning` takes an array of column names, and narrows down the returned values accordingly. This may be useful if you are inserting large objects which you prefer don't take an inefficient return trip over the wire and through the JSON parser.

- `extras` takes a map of string keys to column names and/or `sql` template strings (i.e. `SQLFragments`), allowing you to alias certain columns and/or compute and return other quantities alongside them. The `RunResult` type variable matters in the case of template strings, as it is passed through to the result type.

(Note that type inference can only do the right thing with `returning` and `extras` when `strictNullChecks` are enabled).

For example:

```typescript
const // insert one
  steve = await db
    .insert("authors", {
      name: "Steven Hawking",
      isLiving: false,
    })
    .run(pool),
  // insert many
  [time, me] = await db
    .insert("books", [
      {
        authorId: steve.id,
        title: "A Brief History of Time",
        createdAt: db.sql`now()`,
      },
      {
        authorId: steve.id,
        title: "My Brief History",
        createdAt: db.sql`now()`,
      },
    ])
    .run(pool),
  tags = await db
    .insert("tags", [
      { bookId: time.id, tag: "physics" },
      { bookId: me.id, tag: "physicist" },
      { bookId: me.id, tag: "autobiography" },
    ])
    .run(pool),
  // insert with custom return values
  nutshell = await db
    .insert(
      "books",
      {
        authorId: steve.id,
        title: "The Universe in a Nutshell",
        createdAt: db.sql`now()`,
      },
      {
        returning: ["id"],
        extras: {
          aliasedTitle: "title",
          upperTitle: db.sql<s.books.SQL, string | null>`upper(${"title"})`,
        },
      },
    )
    .run(pool);
```

You'll note that `Insertable`s can take `SQLFragment` values (from the `sql` tagged template function) as well as direct values (strings, numbers, and so on).

Postgres can accept up to 65,536 parameters per query (since [an Int16 is used](https://stackoverflow.com/questions/6581573/what-are-the-max-number-of-allowable-parameters-per-database-provider-type/49379324#49379324) to convey the number of parameters in the _Bind_ message of the [wire protocol](https://www.postgresql.org/docs/current/protocol-message-formats.html)). If there's a risk that a multiple-row `INSERT` could have more inserted values than that, you'll need a mechanism to batch them up into separate calls.

If you provide an empty array to `insert`, this is identified as a no-op, and the database will not actually be queried unless you set the `force` option on `run` to true.

```typescript:showempty
await db.insert("authors", []).run(pool);  // never reaches DB
await db.insert("authors", []).run(pool, true);  // does reach DB, for same result
```

=> shortcuts.ts /_ === update === _/

#### `update`

The `update` shortcut updates rows in the database. It takes a `Table` name and a corresponding `Updatable` and `Whereable` **in that order, matching their order in the raw SQL query**.

It returns a `JSONSelectable[]`, listing every column of every row affected (or a subset or superset of those columns, if you use the `returning` and/or `extras` options, which work just as described above for `insert`).

For example, when we discover with that we've mis-spelled a famous physicist's name, we can do this:

```typescript
await db.update("authors", { name: "Stephen Hawking" }, { name: "Steven Hawking" }).run(pool);
```

Like `Insertable` values, `Updatable` values can also be `SQLFragment`s. For instance, take a table such as the following:

```sql
CREATE TABLE "emailAuthentication"
( "email" citext PRIMARY KEY
, "consecutiveFailedLogins" INTEGER NOT NULL DEFAULT 0
, "lastFailedLogin" TIMESTAMPTZ );
```

To atomically increment the `consecutiveFailedLogins` value, we can do something like this:

```typescript
await db
  .update(
    "emailAuthentication",
    {
      consecutiveFailedLogins: db.sql`${db.self} + 1`,
      // or equivalently: consecutiveFailedLogins: dc.add(1),
      lastFailedLogin: db.sql`now()`,
      // or equivalently: lastFailedLogin: dc.now,
    },
    { email: "me@privacy.net" },
  )
  .run(pool);
```

=> shortcuts.ts /_ === upsert === _/

#### `upsert`

The `upsert` shortcut issues an [`INSERT ... ON CONFLICT ...`](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT) query. Like `insert`, it takes a `Table` name and a corresponding `Insertable` or `Insertable[]`.

It then takes, in addition, a column name (or an array thereof) or an appropriate unique index as the conflict target: the 'arbiter index(es)' on which a conflict is to be detected.

It returns an `UpsertReturnable` or `UpsertReturnable[]`. An `UpsertReturnable` is the same as a `JSONSelectable` except that it includes one additional property, `$action`, taking the string `'INSERT'` or `'UPDATE'` so as to indicate which eventuality occurred for each row.

Let's say we have a table of app subscription transactions:

```sql
CREATE TABLE "appleTransactions"
( "environment" "appleEnvironment" NOT NULL  -- enum: 'PROD' or 'Sandbox'
, "originalTransactionId" TEXT NOT NULL
, "accountId" INTEGER REFERENCES "accounts"("id") NOT NULL
, "latestReceiptData" TEXT );

ALTER TABLE "appleTransactions" ADD CONSTRAINT "appleTransactionsPrimaryKey"
  PRIMARY KEY ("environment", "originalTransactionId");
```

When we receive a purchase receipt, we need to either store a new record or update an existing record for each distinct (`environment`, `originalTransactionId`) it contains.

We can `map` the transaction data in the receipt into an `appleTransactions.Insertable[]`, and do what's needed with a single `upsert` call. In this example, though, we hard-code the `Insertable[]` for ease of exposition:

```typescript
const newTransactions: s.appleTransactions.Insertable[] = [
    {
      environment: "PROD",
      originalTransactionId: "123456",
      accountId: 123,
      latestReceiptData: "TWFuIGlzIGRpc3Rp",
    },
    {
      environment: "PROD",
      originalTransactionId: "234567",
      accountId: 234,
      latestReceiptData: "bmd1aXNoZWQsIG5v",
    },
  ],
  result = await db.upsert("appleTransactions", newTransactions, ["environment", "originalTransactionId"]).run(pool);
```

And it's wholly equivalent here to use the unique index name instead of the column names for the conflict target, by using the `constraint` wrapper function:

```typescript
const anotherNewTransaction: s.appleTransactions.Insertable = {
    environment: "PROD",
    originalTransactionId: "345678",
    accountId: 345,
    latestReceiptData: "lALvEleO4Ehwk3T5",
  },
  result = await db.upsert("appleTransactions", anotherNewTransaction, db.constraint("appleTransactionsPrimaryKey")).run(pool);
```

The same as for `insert`, an empty array provided to `upsert` is identified as a no-op, and the database will not actually be queried unless you set the `force` option on `run` to true.

##### `upsert` options

The optional fourth argument to `upsert` is an `options` object. The available options are `returning` and `extras` (see the documentation for `insert` for details) plus `updateColumns`, `noNullUpdateColumns`, `updateValues` and `reportAction`.

- The `updateColumns` option allows us to specify a subset of columns (as either one name or an array of names) that are to be updated on conflict. For example, you might want to include all columns except `createdAt` in this list.

- The `noNullUpdateColumns` option takes a column name or array of column names which are not to be overwritten with `NULL` in the case that the `UPDATE` branch is taken. It can also take the special value `db.all` to indicate that no column should ever be overwritten with `NULL`.

- The `updateValues` option allows us to specify alternative column values to be used in the `UPDATE` query branch: [see below](#updatevalues).

- The `reportAction: 'suppress'` option causes the `$action` result key to be omitted, so the query returns plain `JSONSelectable` instead of `UpsertReturnable` results.

##### `INSERT ... ON CONFLICT ... DO NOTHING`

A special case arises if you pass the empty array `[]` to the `updateColumns` option of `upsert`.

Since no columns are then to be updated in case of a conflict, an `ON CONFLICT ... DO NOTHING` query is generated instead of an `ON CONFLICT ... DO UPDATE ...` query. For better self-documenting code, an alias for the empty array is provided for this case: `doNothing`.

Since nothing is returned by Postgres for any `DO NOTHING` cases, a query with `updateColumns: []` or `updateColumns: db.doNothing` may return fewer rows than were passed in. If you pass in an array, you could get back an empty array if all rows conflict with existing rows. If you pass in values of a single row, you'll get back `undefined` if a conflict occurs (and the return type will automatically reflect this).

For example:

```sql
CREATE TABLE "usedVoucherCodes"
( "code" text PRIMARY KEY
, "redeemedAt" timestamptz NOT NULL DEFAULT now()
);
```

```typescript:shownull
// unused code: returns the inserted row
const a = await db.upsert('usedVoucherCodes',
  { code: 'XYE953ZVU767' }, 'code',
  { updateColumns: db.doNothing }).run(pool);

// same code, already used: returns undefined
const b = await db.upsert('usedVoucherCodes',
  { code: 'XYE953ZVU767' }, 'code',
  { updateColumns: db.doNothing }).run(pool);
```

##### `updateValues`

You can use the `updateValues` option to specify alternative column values to be used in the `UPDATE` branch of the query. Only one set of values can be provided: these will be used for any and all rows that get updated.

This may be useful, for example, when keeping a count, using a table such as this:

```sql
CREATE TABLE "nameCounts"
( "name" text PRIMARY KEY
, "count" integer NOT NULL
);
```

In the following query, we insert a new value with a count of 1 if a name doesn't already exist in the table. If a name does exist, we increment the existing count instead:

```typescript
for (let i = 0; i < 2; i++) {
  await db.upsert("nameCounts", { name: "Alice", count: 1 }, "name", { updateValues: { count: db.sql`${"nameCounts"}.${"count"} + 1` } }).run(pool);
}
```

=> shortcuts.ts /_ === delete === _/

#### `deletes`

The `deletes` shortcut, unsurprisingly, deletes rows from a table (`delete`, unfortunately, is a JavaScript reserved word). It takes the table name and an appropriate `Whereable` or `SQLFragment`, and by default returns the deleted rows as a `JSONSelectable`.

Again, you can narrow or broaden what's returned with the `returning` and `extras` options, as documented above for `insert`.

For example:

```typescript
await db.deletes("books", { title: "Holes" }, { returning: ["id"] }).run(pool);
```

=> shortcuts.ts /_ === truncate === _/

#### `truncate`

The `truncate` shortcut truncates one or more tables. It takes a `Table` name or a `Table[]` name array, and (optionally) the options `'CONTINUE IDENTITY'`/`'RESTART IDENTITY'` and/or `'RESTRICT'`/`'CASCADE'`.

For instance:

```typescript
await db.truncate("bankAccounts").run(pool);
```

One context in which this may be useful is in emptying a testing database at the start of each test run.

First, we list all our tables. @brand-map/postgres provides some [utility types](/utility-types#utility-types) such as `AllBaseTables`, to help ensure that we don't forget any:

```typescript:noresult
const allTables: s.AllBaseTables = [
  'appleTransactions',
  'arrays',
  'authors',
  'bankAccounts',
  'bigints',
  'books',
  'doctors',
  'emailAuthentication',
  'employees',
  'nameCounts',
  'numerics',
  'photos',
  'shifts',
  'stores',
  'subjectPhotos',
  'subjects',
  'tags',
  'usedVoucherCodes',
  'users',
];
```

We can then empty the database like so:

```typescript:norun
// *** DON'T DO THIS IN PRODUCTION! ***
await db.truncate(allTables, 'CASCADE').run(pool);
```

=> shortcuts.ts /_ === select === _/

#### `select`, `selectOne`, and `selectExactlyOne`

The `select` shortcut function, in its basic form, takes a `Table` name and some `WHERE` conditions, and returns a `SQLFragment<JSONSelectable[]>`. Those `WHERE` conditions can be the symbol `all` (meaning: no conditions), a `SQLFragment` from a `sql` template string, or the appropriate `Whereable` for the target table (recall that [a `Whereable` can itself contain `SQLFragment` values](/sql-and-fragments#whereable)).

`selectOne` does the same, except that it gives us a `SQLFragment<JSONSelectable | undefined>`, promising _only a single object_ (or `undefined`) when run.

`selectExactlyOne` function does the same as `selectOne`, except that it eliminates the `undefined` case (to give: `SQLFragment<JSONSelectable>`). Instead, it will throw an error (with a helpful `query` property) if it doesn't find a row.

In use, they look like this:

```typescript
// select, no WHERE clause
const allBooks = await db.select("books", db.all).run(pool);
```

```typescript
// select, Whereable
const authorBooks = await db.select("books", { authorId: 1000 }).run(pool);
```

```typescript
// selectOne (since authors.id is a primary key), Whereable
const oneAuthor = await db.selectOne("authors", { id: 1000 }).run(pool);
```

```typescript
// selectExactlyOne, Whereable
// (for a more useful example, see the section on `lateral`, below)
try {
  const exactlyOneAuthor = await db.selectExactlyOne("authors", { id: 999 }).run(pool);
  // ... do something with this author ...
} catch (err: any) {
  if (err instanceof db.NotExactlyOneError) console.log(`${err.name}: ${err.message}`);
  else throw err;
}
```

```typescript
// select, Whereable with embedded SQLFragment
const recentAuthorBooks = await db
  .select("books", {
    authorId: 1001,
    createdAt: db.sql`${db.self} > now() - INTERVAL '7 days'`,
  })
  .run(pool);
```

```typescript
// select, Whereables with conditions helpers
const alsoRecentAuthorBooks = await db
  .select("books", {
    authorId: 1001,
    createdAt: dc.after(dc.fromNow(-7, "days")),
  })
  .run(pool);
```

```typescript
// select, SQLFragment with embedded Whereables
const anOddSelectionOfBooksToDemonstrateAnOrCondition = await db.select("books", db.sql<s.books.SQL>`${{ id: 1 }} OR ${{ authorId: 2 }}`).run(pool);
```

Similar to our earlier shortcut examples, once I've typed in `'books'` or `'authors'` as the first argument to the function, TypeScript and VS Code know both how to type-check and auto-complete both the `WHERE` argument and the type that will returned by `run`.

The `select` and `selectOne` shortcuts can also take an `options` object as their third argument, which has a large set of potential keys: `columns`, `order`, `limit`, `offset`, `lateral`, `alias`, `extras`, `groupBy`, `having`, `distinct` and `lock`.

##### `columns`

The `columns` key specifies that we want to return only a subset of columns, perhaps for reasons of efficiency. It takes an array of `Column` names for the appropriate table, and works in just the same way as the `returning` option on the other query types. For example:

```typescript
const bookTitles = await db.select("books", db.all, { columns: ["title"] }).run(pool);
```

The return type is of course appropriately narrowed to the requested columns only, so VS Code will complain if we now try to access `bookTitles[0].authorId`, for example. (Note: this works only when `strictNullChecks` are in operation).

The `columns` option does not enable column aliasing — i.e. you can't use it to do `SELECT "column" AS "aliasedColumn"` or its equivalent — but column aliasing _is_ easily achieved using the `extras` option instead.

##### `order`, `limit` and `offset`

The `limit` and `offset` options each take a number and pass it directly through to SQL `LIMIT` and `OFFSET` clauses. The `order` option takes a single `OrderSpecForTable` or an `OrderSpecForTable[]` array, which has this shape:

```typescript:norun
interface OrderSpecForTable<T extends Table> {
  by: SQLForTable<T>;
  direction: 'ASC' | 'DESC';
  nulls?: 'FIRST' | 'LAST';
}
```

Putting them together gives us queries like this:

```typescript
const [lastButOneBook] = await db
  .select("books", db.all, {
    order: { by: "createdAt", direction: "DESC" },
    limit: 1,
    offset: 1,
  })
  .run(pool);
```

I used destructuring assignment here (`const [lastButOneBook] = /* ... */;`) to account for the fact that I know this query is only going to return one response. Unfortunately, destructuring is just syntactic sugar for indexing, and indexing in TypeScript [doesn't reflect that the result may be undefined](https://github.com/Microsoft/TypeScript/issues/13778) unless you have [`--noUncheckedIndexedAccess`](https://devblogs.microsoft.com/typescript/announcing-typescript-4-1/#no-unchecked-indexed-access) turned on. That means that `lastButOneBook` is now typed as a `JSONSelectable`, but it could actually be `undefined`, and that could lead to errors down the line.

To fix this, we can use the `selectOne` function instead, which turns the example above into the following:

```typescript
const lastButOneBook = await db
  .selectOne("books", db.all, {
    order: [{ by: "createdAt", direction: "DESC" }],
    offset: 1,
  })
  .run(pool);
```

The `{ limit: 1 }` option is now applied automatically. And the return type following `await` needs no destructuring and is now, correctly, `JSONSelectable | undefined`.

##### `lateral` and `alias`

Earlier we put together [some big `LATERAL` joins of authors and books](#manual-joins-using-postgres-json-features). This was a powerful and satisfying application of Postgres' JSON support ... but also a bit of an eyesore, heavy on both punctuation and manually constructed and applied types.

We can improve on this. Since `SQLFragments` are already designed to contain other `SQLFragments`, it's a pretty small leap to enable `select` calls to be nested inside other `select` calls in order to significantly simplify this kind of `LATERAL` join query.

We achieve this with an additional `options` key, `lateral`. This `lateral` key takes either a single nested query shortcut, or an object that maps one or more property names to query shortcuts.

###### `lateral` property maps

Let's deal with the latter case — the map of property names to query shortcuts — first. It allows us to write an even bigger join (of books, each with their author and tags) like so:

```typescript
const booksAuthorTags = await db
  .select("books", db.all, {
    lateral: {
      author: db.selectExactlyOne("authors", { id: db.parent("authorId") }),
      tags: db.select("tags", { bookId: db.parent("id") }),
    },
  })
  .run(pool);
```

The result here is a `books.JSONSelectable`, augmented with both an `author` property (containing an `authors.JSONSelectable`) and a `tags` property (containing a `tags.JSONSelectable[]` array).

Note that we use `selectExactlyOne` in the nested author query because a book's `authorId` is defined as `NOT NULL REFERENCES "authors"("id")`, and we can therefore be 100% certain that we'll get back a row here.

We could of course turn this around, nesting more deeply to retrieve authors, each with their books, each with their tags:

```typescript
const authorsBooksTags = await db
  .select("authors", db.all, {
    lateral: {
      books: db.select(
        "books",
        { authorId: db.parent("id") },
        {
          lateral: {
            tags: db.select("tags", { bookId: db.parent("id") }, { columns: ["tag"] }),
          },
        },
      ),
    },
  })
  .run(pool);
```

You'll note the use of the `parent` function to refer to a join column in the table of the containing query. This is a simple convenience: in the join of books to authors above, we could just as well formulate the `Whereable` as:

```typescript:norun
{ authorId: sql`${"authors"}.${"id"}` }
```

We can also nest [aggregate calls such as `count`](#count-avg-sum-min-and-max). And we can join a table to itself, though in that case we _must_ remember to use the `alias` option to define an alternative table name, resolving ambiguity for Postgres.

Take this new, self-referencing table:

```sql
CREATE TABLE "employees"
( "id" SERIAL PRIMARY KEY
, "name" TEXT NOT NULL
, "managerId" INTEGER REFERENCES "employees"("id") );
```

Add some employees:

```typescript
const anna = await db.insert("employees", { name: "Anna" }).run(pool),
  [beth, charlie] = await db
    .insert("employees", [
      { name: "Beth", managerId: anna.id },
      { name: "Charlie", managerId: anna.id },
    ])
    .run(pool),
  dougal = await db.insert("employees", { name: "Dougal", managerId: beth.id }).run(pool);
```

Then query for a summary (joining the table to itself twice, with appropriate aliasing):

```typescript
const people = await db
  .select("employees", db.all, {
    columns: ["name"],
    lateral: {
      lineManager: db.selectOne("employees", { id: db.parent("managerId") }, { alias: "managers", columns: ["name"] }),
      directReports: db.count("employees", { managerId: db.parent("id") }, { alias: "reports" }),
    },
  })
  .run(pool);
```

As usual, this is fully typed. If, for example, you were to forget that `directReports` is a count rather than an array of employees, VS Code would soon disabuse you.

###### `lateral` pass-through

As previously mentioned, the `lateral` key can also take a single nested query shortcut. In this case, the result of the lateral query is promoted and passed directly through as the result of the parent query. This can be helpful when working with many-to-many relationships between tables.

For instance, let's say we've got two tables, `photos` and `subjects`, where `subjects` holds data on the people who appear in the photos. This is a many-to-many relationship, since a photo can have many subjects and a subject can be in many photos. We model it with a third table, `subjectPhotos`.

Here are the tables:

```sql
CREATE TABLE "photos"
( "photoId" int PRIMARY KEY GENERATED ALWAYS AS IDENTITY
, "url" text NOT NULL
);
CREATE TABLE "subjects"
( "subjectId" int PRIMARY KEY GENERATED ALWAYS AS IDENTITY
, "name" text NOT NULL
);
CREATE TABLE "subjectPhotos"
( "subjectId" int NOT NULL REFERENCES "subjects"("subjectId")
, "photoId" int NOT NULL REFERENCES "photos"("photoId")
, CONSTRAINT "userPhotosUnique" UNIQUE ("subjectId", "photoId")
);
```

Insert some data:

```typescript
const [alice, bobby, cathy] = await db.insert("subjects", [{ name: "Alice" }, { name: "Bobby" }, { name: "Cathy" }]).run(pool),
  [photo1, photo2, photo3] = await db.insert("photos", [{ url: "photo1.jpg" }, { url: "photo2.jpg" }, { url: "photo3.jpg" }]).run(pool);

await db
  .insert("subjectPhotos", [
    { subjectId: alice.subjectId, photoId: photo1.photoId },
    { subjectId: alice.subjectId, photoId: photo2.photoId },
    { subjectId: bobby.subjectId, photoId: photo2.photoId },
    { subjectId: cathy.subjectId, photoId: photo1.photoId },
    { subjectId: cathy.subjectId, photoId: photo3.photoId },
  ])
  .run(pool);
```

And now query for all photos with their subjects:

```typescript
const photos = await db
  .select("photos", db.all, {
    lateral: {
      subjects: db.select(
        "subjectPhotos",
        { photoId: db.parent() },
        {
          lateral: db.selectExactlyOne("subjects", { subjectId: db.parent() }),
        },
      ),
    },
  })
  .run(pool);
```

Note that the `subjects` subquery is passed directly to the `lateral` option of the `subjectPhotos` query, and its result is therefore passed straight through, effectively overwriting the `subjectPhotos` query result. That's fine, since the intermediate `subjectPhotos` results would be effectively just noise here, in the form of duplicate copies of the `photoId` and `subjectId` primary keys.

Note also that when a lateral join matches on the same column name in the parent and child tables, you can omit that column name from the call to `parent()`. In other words, `{ columnName: db.parent() }` is equivalent to `{ columnName: db.parent('columnName') }`.

When you pass a nested query directly to the `lateral` option of a parent query, nothing else is returned from that parent query. For this reason, specifying `columns` or `extras` on the parent query would have no effect, and trying to do so will give you a type error.

###### Limitations

There are still a few limitations to type inference for nested queries. First, there's no check that your joins make sense (column types and `REFERENCES` relationships are not exploited in the `Whereable` term). Second, we need to manually specify `selectExactlyOne` instead of `selectOne` when we know that a join will always produce a result — such as when the relevant foreign key is `NOT NULL` and has a `REFERENCES` constraint — which in principle might be inferred for us. Third, note that `strictNullChecks` (or `strict`) must be turned on in `tsconfig.json`, or nothing gets added to the return type.

Nevertheless, this is a handy, flexible — but still transparent and zero-abstraction — way to generate and run complex join queries.

##### `extras`

The `extras` option allows us to include additional result keys that don't directly replicate the columns of our tables. That can be a computed quantity, such as a geographical distance via [PostGIS](https://postgis.net/), or it can be a simple column alias.

As is discussed above for `insert`, the `extras` option takes a mapping of property names to column names and/or `sql` template strings (i.e. `SQLFragments`). The `RunResult` type variable of any template string is significant, since it is passed through to the result type.

Let's see `extras` in use, with an example that shows too how the `lateral` option can go well beyond simply matching a foreign key to a primary key.

Take this new table:

```sql
CREATE EXTENSION postgis;
CREATE TABLE "stores"
( "id" SERIAL PRIMARY KEY
, "name" TEXT NOT NULL
, "geom" GEOMETRY NOT NULL );
CREATE INDEX "storesGeomIdx" ON "stores" USING gist("geom");
```

Insert some new stores:

```typescript
const gbPoint = (mEast: number, mNorth: number) => db.sql`ST_SetSRID(ST_Point(${db.param(mEast)}, ${db.param(mNorth)}), 27700)`;

const [brighton] = await db
  .insert("stores", [
    { name: "Brighton", geom: gbPoint(530590, 104190) },
    { name: "London", geom: gbPoint(534930, 179380) },
    { name: "Edinburgh", geom: gbPoint(323430, 676130) },
    { name: "Newcastle", geom: gbPoint(421430, 563130) },
    { name: "Exeter", geom: gbPoint(288430, 92130) },
  ])
  .run(pool);
```

And now query my local store (Brighton) plus its three nearest alternatives, with their distances in metres, using PostGIS's index-aware [`<-> operator`](https://postgis.net/docs/geometry_distance_knn.html):

```typescript
const distance = db.sql<s.stores.SQL, number>`${"geom"} <-> ${db.parent("geom")}`,
  localStore = await db
    .selectOne(
      "stores",
      { id: 1 },
      {
        columns: ["name"],
        lateral: {
          alternatives: db.select(
            "stores",
            { id: dc.ne(db.parent("id")) },
            {
              alias: "nearby",
              columns: ["id"],
              extras: {
                distance, // <-- i.e. distance: distance, referring to the SQLFragment just defined
                storeName: "name", // <-- a simple alias for the name column
              },
              order: { by: distance, direction: "ASC" },
              limit: 3,
            },
          ),
        },
      },
    )
    .run(pool);
```

The `extras` option requires `strictNullChecks` (or `strict`) to be turned on in `tsconfig.json`.

##### `groupBy` and `having`

The `groupBy` and `having` options work as you'd probably expect. The value of `groupBy` should be a single `Column`, a `Column[]` array or a `SQLFragment`. The value of `having` should be a `Whereable` or `SQLFragment`.

You'll likely want to use these in conjunction with [`columns`](#columns) and [`extras`](#extras). To take a rather contrived example:

```typescript
const multiBookAuthorTitleData = await db
  .select("books", db.all, {
    columns: ["authorId"],
    extras: {
      titleCount: db.sql<s.books.SQL, number>`count(${"title"})`,
      titleChars: db.sql<s.books.SQL, number>`sum(char_length(${"title"}))`,
    },
    groupBy: "authorId",
    having: db.sql<s.books.SQL>`count(${"title"}) > 1`,
  })
  .run(pool);
```

##### `distinct`

The `distinct` option, unsurprisingly, adds [`DISTINCT`](https://www.postgresql.org/docs/current/sql-select.html#SQL-DISTINCT) to your query. If `true` it adds only `DISTINCT`. If a single `Column`, a `Column[]` array, or a `SQLFragment`, it adds the appropriate `DISTINCT ON (/* ... */)` clause.

For instance:

```typescript
const books1 = await db.select("books", db.all, { distinct: true }).run(pool),
  books2 = await db.select("books", db.all, { distinct: "title" }).run(pool),
  books3 = await db.select("books", db.all, { distinct: ["title", "authorId"] }).run(pool),
  books4 = await db.select("books", db.all, { distinct: db.sql`upper(${"title"})` }).run(pool);
```

(For the `DISTINCT ON` variants, you should really use [`order`](#order-limit-and-offset) too, or you don't really know which rows you'll get).

##### `lock`

The `lock` option defines a [locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE). It takes a `SelectLockingOptions` object or `SelectLockingOptions[]` array, defined as:

```typescript:norun
export interface SelectLockingOptions {
  for: 'UPDATE' | 'NO KEY UPDATE' | 'SHARE' | 'KEY SHARE';
  of?: Table | Table[];
  wait?: 'NOWAIT' | 'SKIP LOCKED';
}
```

(And yes, this allows for arbitrary locking scenarios that a shorcut `select` can't yet need).

A couple of examples:

```typescript
const authors1 = await db
  .select("authors", db.all, {
    lock: { for: "NO KEY UPDATE" },
  })
  .run(pool);

const authors2 = await db
  .select("authors", db.all, {
    lock: { for: "UPDATE", of: "authors", wait: "NOWAIT" },
  })
  .run(pool);
```

=> shortcuts.ts /_ === count, sum, avg === _/

#### `count`, `avg`, `sum`, `min` and `max`

The `count`, `avg`, `sum`, `min` and `max` functions generate `SELECT` queries that apply the relevant aggregate to matching rows, and so each return a `SQLFragment<number>`.

They're used in a very similar way to `select`, like this:

```typescript
const numberOfAuthors = await db.count("authors", db.all).run(pool);
```

#### `JSONSelectable`

Since the shortcut functions build on Postgres' JSON support, their return values are typed `JSONSelectable` rather than the `Selectable` you'd get back from a manual query (this would not in fact be a hard requirement for all shortcuts, but in the interests of consistency it does apply to all of them).

`JSONSelectable`s differ from `Selectable`s in that some data types that would normally be converted to native JavaScript representations by `pg` are instead returned in the string format produced by the Postgres `to_json` function. Namely:

- Date/time columns are returned as plain strings in both `Selectable` and `JSONSelectable` results.

- `bigint`/`int8` and `numeric`/`decimal` columns are returned as string values (of template string type `` `${number}` ``) in a `Selectable`, but as numbers in a `JSONSelectable`. This point is discussed in the next section.

- `bytea` columns are returned as `ByteArrayString`, defined as `` `\\x{string}` ``. A `toBuffer()` function is provided for use with these. For performance and memory reasons, this should not be used for large objects: in that case, consider something like [pg-large-object](https://www.npmjs.com/package/pg-large-object) instead.

- Range types such as `numrange` also get template string types. (Unfortunately, unlike standalone time/date types, which are always returned in ISO8601 format in JSON, time/date bounds in ranges are formatted according to Postgres' current `DateStyle` setting, so can't be typed more specifically than `string`).

If you're using a time/date library such as [Luxon](https://moment.github.io/luxon/) or [Moment](https://momentjs.com/), parse and format these strings in your own app layer.

##### Custom JSON parsing for `bigint` and `numeric`

All numeric values are returned as ordinary number literals in Postgres' JSON types. That means `bigint`/`int8` values could exceed `Number.MAX_SAFE_INTEGER` (and might become different integers in the process), while `numeric`/`decimal` values could overflow `Number.MAX_VALUE` or lose precision. I've written about this issue in more detail [elsewhere](https://neon.tech/blog/parsing-json-from-postgres-in-js).

For this reason, if your database includes any `bigint`/`int8` or `numeric`/`decimal` columns, a warning will be printed at schema-generation time (since @brand-map/postgres version 6.3).

To address this issue:

- Set `"customJsonParsingForLargeNumbers": true` in the schema-generation config in `brand-map-postgres.config.json`. This switches the TypeScript types for these columns in `JSONSelectable`s from `number` to `` number | `${number}` ``. It also suppresses the warning.

- Be sure to call `db.enableCustomJSONParsingForLargeNumbers(pg)` in your code before running any queries. This switches node-postgres's JSON parsing to use the [json-custom-numbers](https://github.com/jawj/json-custom-numbers) package, and return as strings any values that aren't representable as a JS number.

When using these `` number | `${number}` `` values in code, you will likely want to convert integers to [`BigInt`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) and decimals to a third-party decimal format such as [big.js](https://github.com/MikeMcl/big.js) at the earliest opportunity.

Here's an example:

```typescript
import * as db from "@brand-map/postgres/pg";
import pool from "./pgPool.js";
import pg from "pg";
import Big from "big.js"; // third-party arbitrary-precision library

// note: set `"customJsonParsingForLargeNumbers": true` in brand-map-postgres.config.json

db.enableCustomJSONParsingForLargeNumbers(pg);

// bigints

const bigints = await db.select("bigints", db.all, { order: { by: "bigintValue", direction: "ASC" } }).run(pool);

for (const { bigintValue: raw } of bigints) {
  // raw is number | `${number}`
  const number = Number(raw); // DON'T do this: may become a different integer
  const bigint = BigInt(raw); // do this instead

  console.log("raw:", raw, "/ as Number:", number, "/ as BigInt:", bigint);

  // Note that numbers above `Number.MAX_SAFE_INTEGER` are still returned as
  // numbers *if* that doesn't change them. For example, 9007199254740993 is
  // returned as a string (because it would become 9007199254740992), but
  // 9007199254740992 is safely returned as an ordinary number, even though
  // it's `Number.MAX_SAFE_INTEGER + 1`.
}

// numerics

const numerics = await db.select("numerics", db.all, { order: { by: "numericValue", direction: "ASC" } }).run(pool);

for (const { numericValue: raw } of numerics) {
  // raw is number | `${number}`
  const number = Number(raw); // DON'T do this: may overflow or lose precision
  const bigdec = Big(raw); // do this instead

  console.log("raw:", raw, "/ as Number:", number, "/ as Big:", bigdec);
}

await pool.end();
```

=> transaction.ts export async function transaction<T, M extends IsolationLevel>(
