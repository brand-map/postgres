---
outline: deep
---

# SQL And Fragments

### `sql` tagged template strings

Arbitrary queries are written using the tagged template function `sql`, which returns [`SQLFragment`](#sqlfragment) class instances.

The `sql` function is [generic](https://www.typescriptlang.org/docs/handbook/generics.html), having two type variables. For example:

```typescript
const authors = await db.sql<s.authors.SQL, s.authors.Selectable[]>`
  SELECT * FROM ${"authors"}`.run(pool);
```

The first type variable, `Interpolations` (above: `s.authors.SQL`), defines allowable interpolation values. If not specified, it defaults to `db.SQL`: this is the union of all the per-table `SQL` types, and thus allows all table and column names present in the database as string interpolations (some of which would throw runtime errors in this case).

As another example, imagine we were joining the `authors` and `books` tables. Then we could specify `s.authors.SQL | s.books.SQL` for `Interpolations` here.

The second type variable, `RunResult` (above: `s.authors.Selectable[]`), describes what will be returned if we call `run()` on the query (after any transformations performed in [`runResultTransform()`](#runresulttransform-qr-pgqueryresult--any)), or if we embed it within the [`extras`](/joins-and-shortcuts#extras) or [`lateral`](/joins-and-shortcuts#lateral-and-alias) query options. Its default value if not specified is `any[]`.

Take another example of these type variables:

```typescript
const [{ random }] = await db.sql<never, [{ random: number }]>`
  SELECT random()`.run(pool);

console.log(random);
```

`Interpolations` is `never` because nothing needs to be interpolated in this query, and the `RunResult` type says that the query will return one row comprising one numeric column, named `random`. The `random` TypeScript variable we initialize will of course be typed as a `number`.

If you're happy to have your types tied down a little less tightly, it also works to wholly omit the type variables in this particular query, falling back on their defaults:

```typescript:noresult
const [{ random }] = await db.sql`SELECT random()`.run(pool);
```

In this case, the `random` variable is of course still a `number`, but it is typed as `any`.

### `sql` template interpolation types

#### Strings

The strings that can be directly interpolated into a `sql` template string are defined by its `Interpolations` type variable, [as noted above](#sql-tagged-template-strings). Typically, this will limit them to the names of tables and columns.

Interpolated strings are passed through to the raw SQL query double-quoted, to preserve capitalisation and neutralise SQL keywords. For example, `myTable` becomes `"myTable"`, and `mySchema.myTable` becomes `"mySchema"."myTable"`.

It's highly preferable to use interpolated string literals for table and column names rather than just writing those values in the query itself, in order to benefit from auto-completion and (ongoing) type-checking.

So, for example, do write:

```typescript:noresult
const title = await db.sql`
  SELECT ${"title"} FROM ${"books"} LIMIT 1`.run(pool);
```

But **don't** write

```typescript:noresult
const title = await db.sql`
  SELECT "title" FROM "books" LIMIT 1`.run(pool);  // no, don't do this
```

— even if the two produce the same result right now.

More critically, **never never never** explicitly override type-checking so as to write:

```typescript
const nameSubmittedByUser = 'books"; DROP TABLE "authors"; --',
  title = await db.sql<any>`
    SELECT * FROM ${nameSubmittedByUser} LIMIT 1`.run(pool); // NEVER do this!
```

If you override type-checking to pass untrusted data to @brand-map/postgres in unexpected places, such as the above use of `any`, you can expect successful SQL injection attacks.

(It _is_ safe to pass untrusted data as values in `Whereable`, `Insertable`, and `Updatable` objects, manually by using [`param`](#paramvalue-any-cast-boolean--string-parameter), and in certain other places. If you're in any doubt, double-check that the generated SQL is using `$1`, `$2`, ... parameters for all potentially untrusted data).

#### `cols()` and `vals()`

The `cols` and `vals` wrapper functions (which return `ColumnNames` and `ColumnValues` class instances respectively) are intended to help with certain `INSERT` and `SELECT` queries.

In the `INSERT` context, pass them each the same `Insertable` object: `cols` is compiled to a comma-separated list of the object's keys, which are the column names, and `vals` is compiled to a comma-separated list of SQL placeholders (`$1`, `$2`, ...) associated with the corresponding values, in matching order. To return to (approximately) an earlier example:

```typescript
const author: s.authors.Insertable = {
    name: "Joseph Conrad",
    isLiving: false,
  },
  [insertedAuthor] = await db.sql<s.authors.SQL, s.authors.Selectable[]>`
    INSERT INTO ${"authors"} (${db.cols(author)})
    VALUES (${db.vals(author)}) RETURNING *`.run(pool);
```

The `cols` and `vals` wrappers can also each take an array instead of an object.

For the `cols` function, this can help us select only a subset of columns, in conjunction with the `OnlyCols` type. Pass an array of column names to `cols` to have them compiled appropriately, as seen in this example:

```typescript
// the <const> prevents generalization to string[]
const bookCols = <const>["id", "title"];
type BookDatum = s.books.OnlyCols<typeof bookCols>;

const bookData = await db.sql<s.books.SQL, BookDatum[]>`
    SELECT ${db.cols(bookCols)} FROM ${"books"}`.run(pool);
```

For the `vals` function, this can help with `IN (...)` queries, such as the following:

```typescript
const authorIds = [1, 2, 123],
  authors = await db.sql<s.authors.SQL, s.authors.Selectable[]>` 
    SELECT * FROM ${"authors"} WHERE ${"id"} IN (${db.vals(authorIds)})`.run(pool);
```

#### `Whereable`

Any plain JavaScript object interpolated into a `sql` template string is type-checked as a `Whereable`, and compiled into one or more conditions joined with `AND` (but, for flexibility, no `WHERE`). The object's keys represent column names, and the corresponding values are automatically compiled as (injection-safe) [`Parameter`](#paramvalue-any-cast-boolean--string-parameter) instances.

For example:

```typescript
const title = "Northern Lights",
  books = await db.sql<s.books.SQL, s.books.Selectable[]>`
    SELECT * FROM ${"books"} WHERE ${{ title }}`.run(pool);
```

(If you need to specify a `CAST` of a parameter to a specific SQL type, you can also manually wrap `Whereable` values using [`param`](#paramvalue-any-cast-boolean--string-parameter) — this is useful primarily when using [the shortcut functions](/joins-and-shortcuts#shortcut-functions-and-lateral-joins)).

A `Whereable`'s values can alternatively be `SQLFragments`, and this makes them extremely flexible. In a `SQLFragment` inside a `Whereable`, the special symbol `self` can be used to refer to the column name. This arrangement enables us to use any operator or function we want — not just `=`.

For example:

```typescript
const titleLike = "Northern%",
  books = await db.sql<s.books.SQL, s.books.Selectable[]>`
    SELECT * FROM ${"books"} WHERE ${{
      title: db.sql`${db.self} LIKE ${db.param(titleLike)}`,
      createdAt: db.sql`${db.self} > now() - INTERVAL '7 days'`,
    }}`.run(pool);
```

Finally, there's a set of helper functions you can use to create appropriate `SQLFragment`s like these for use as `Whereable` values. The advantages are: (1) there's slighly less to type, and (2) you get type-checking on their arguments (so you're not tempted to compare incomparable things).

They're exported under `conditions` on the main object, and the full set can be seen in [conditions.ts](https://github.com/jawj/zapatos/blob/master/src/db/conditions.ts). Using some of these, we could rewrite the above example as:

```typescript
const titleLike = "Northern%",
  books = await db.sql<s.books.SQL, s.books.Selectable[]>`
    SELECT * FROM ${"books"} WHERE ${{
      title: dc.like(titleLike),
      createdAt: dc.after(dc.fromNow(-7, "days")),
    }}`.run(pool);
```

#### `self`

The use of the `self` symbol is explained in [the section on `Whereable`s](#whereable).

#### `param(value: any, cast?: boolean | string): Parameter`

In general, @brand-map/postgres' type-checking won't let us [pass user-supplied data unsafely into a query](https://xkcd.com/327/) by accident. The `param` wrapper function exists to enable the safe passing of user-supplied data into a query using numbered query parameters (`$1`, `$2`, ...).

For example:

```typescript
const title = "Pride and Prejudice",
  books = await db.sql<s.books.SQL, s.books.Selectable[]>`
    SELECT * FROM ${"books"} WHERE ${"title"} = ${db.param(title)}`.run(pool);
```

This same mechanism is applied automatically when we use [a `Whereable` object](#whereable) (and in this example, using a `Whereable` would be more readable and more concise). It's also applied when we use [the `vals` function](#cols-and-vals) to create a `ColumnValues` wrapper object.

The optional second argument to `param`, `cast`, allows us to specify a SQL `CAST` type for the wrapped value. If `cast` is a string, it's interpreted as a Postgres type, so `param(someValue, 'text')` comes out in the compiled query as as `CAST($1 TO "text")`. If `cast` is `true`, the parameter value will be JSON stringified and cast to `json`, and if `cast` is `false`, the parameter will **not** be JSON stringified or cast to `json` (regardless, in both cases, of [the `castArrayParamsToJson` and `castObjectParamsToJson` configuration options](/runtime-configuration#casting-parameters-to-json)).

#### `Default`

The `Default` symbol simply compiles to the SQL `DEFAULT` keyword. This may be useful in `INSERT` and `UPDATE` queries where no value is supplied for one or more of the affected columns.

#### `sql` template strings

`sql` template strings (resulting in `SQLFragment`s) can be interpolated within other `sql` template strings (`SQLFragment`s). This provides flexibility in building queries programmatically.

For example, the [`select` shortcut](/joins-and-shortcuts#select-selectone-and-selectexactlyone) makes extensive use of nested `sql` templates to build its queries:

```typescript:norun
const
  rowsQuery = sql<SQL, any>`
    SELECT ${allColsSQL} AS result
    FROM ${table}${tableAliasSQL}
    ${lateralSQL}${whereSQL}${orderSQL}${limitSQL}${offsetSQL}`,

  // we need the aggregate function, if one's needed, to sit in an outer
  // query, to keep ORDER and LIMIT working normally in the main query
  query = mode !== SelectResultMode.Many ? rowsQuery :
    sql<SQL, any>`
      SELECT coalesce(jsonb_agg(result), '[]') AS result
      FROM (${rowsQuery}) AS ${raw(`"sq_${aliasedTable}"`)}`;
```

#### Arrays

Items in an interpolated array are treated just the same as if they had been interpolated directly. This, again, can be useful for building queries programmatically.

To take the [`select` shortcut](/joins-and-shortcuts#select-selectone-and-selectexactlyone) as our example again, an interpolated array is used to generate `LATERAL JOIN` query elements from the `lateral` option, like so:

```typescript:norun
const
  lateralOpt = allOptions.lateral,
  lateralSQL = lateralOpt === undefined ? [] :
    Object.keys(lateralOpt).map(k => {
      const subQ = lateralOpt[k];
      subQ.parentTable = aliasedTable;  // enables `parent()` in subquery's Whereables
      return sql<SQL>` LEFT JOIN LATERAL (${subQ}) AS ${raw(`"cj_${k}"`)} ON true`;
    });
```

The `lateralSQL` variable — a `SQLFragment[]` — is subsequently interpolated into the final query (some additional SQL using `jsonb_build_object()` is interpolated earlier in that query, to return the result of the lateral subquery alongside the main query columns).

Note that a useful idiom also seen here is the use of the empty array (`[]`) to conditionally interpolate nothing at all.

#### `raw(value: string): DangerousRawString`

The `raw` function returns `DangerousRawString` wrapper instances. This represents an escape hatch, enabling us to interpolate arbitrary strings into queries in contexts where the `param` wrapper is unsuitable (such as when we're interpolating basic SQL syntax elements). **If you pass user-controlled data to this function you will open yourself up to SQL injection attacks.**

#### `parent(columnName?: string): ParentColumn`

Within queries passed as subqueries to the `lateral` option of `select` and related queries, the `parent()` wrapper can be used to refer to a column of the table that's the subject of the immediately containing query (the 'parent' table).

To refer to a column of the parent table by name, pass a `string` argument. If the column of the parent table has the same name as the column with which it's being joined, no argument is required.

For usage details, see the [documentation for the `lateral` option](/joins-and-shortcuts#lateral-and-alias).

### `SQLFragment`

`SQLFragment<RunResult>` class instances are what is returned by the `sql` tagged template function — you're unlikely ever to contruct them directly with `new`. They take on the `RunResult` type variable from the `sql` template function that constructs them.

You can [interpolate them](#sql-template-strings) into other `sql` tagged template strings, or call/access the following properties on them:

`core.ts prepared = (name = _brand_map_postgres_prepared_${preparedNameSeq++})`

#### `prepared(name: string): this`

The `prepared` function causes a `name` property to be added to the compiled SQL query object that's passed to `pg`, and this [instructs Postgres to treat it as a prepared statement](https://node-postgres.com/features/queries#prepared-statements). You can specify a prepared statement name as the function's argument, or let it default to `"_brand_map_postgres_prepared_N"` (where N is a sequence number). This name appears in the Postgres logs.

`core.ts run = async (queryable: Queryable, force = false): Promise<RunResult> `

#### `async run(queryable: Queryable, force = false): Promise<RunResult>`

The `run` function compiles, executes, and returns the transformed result of the query represented by this `SQLFragment`. The `awaited` return value is typed according to the `SQLFragment`'s `RunResult` type variable.

Taking that one step at a time:

1. First, [the `compile` function](#compile-sqlquery) is called, recursively compiling this `SQLFragment` and its interpolated values into a `{ text: '', values: [] }` query that can be passed straight to the `pg` module. If a `queryListener` function [has been configured](/runtime-configuration#run-time-configuration), it is called with the query as its argument now.

2. Next, the compiled SQL query is executed against the supplied `Queryable`, which is defined as a `pg.Pool` or `pg.ClientBase` (this definition also covers the `TxnClient` provided by the [`transaction` helper function](/transactions#transaction)).

3. Finally, the result returned from `pg` is fed through this `SQLFragment`'s [`runResultTransform()`](#runresulttransform-qr-pgqueryresult--any) function, whose default implementation simply returns the `rows` property of the result. If a `resultListener` function [has been configured](/runtime-configuration#run-time-configuration), it is called with the transformed result as its argument now.

Examples of the `run` function are scattered throughout this documentation.

The `force` parameter is relevant only if this `SQLFragment` has been marked as a [no-op](https://en.wiktionary.org/wiki/no-op#Etymology_2): at present, @brand-map/postgres does this automatically if you pass an empty array to `insert` or `upsert`. By default, the database will not be disturbed in such cases, but you can force a no-op query to actually be run against the database — perhaps for logging or triggering reasons — by setting `force` to `true`.

=> core.ts compile = (result: SQLQuery = { text: '', values: [] }, parentTable?: string, currentColumn?: Column) => {

#### `compile(): SQLQuery`

The `compile` function recursively transforms this `SQLFragment` and its interpolated values into a `SQLQuery` object (`{ text: string; values: any[]; }`) that can be passed straight to the `pg` module. It is called without arguments (the arguments it can take are for internal use).

For example:

```typescript
const authorId = 12, // from some untrusted source
  query = db.sql<s.books.SQL, s.books.Selectable[]>`
    SELECT * FROM ${"books"} WHERE ${{ authorId }}`,
  compiled = query.compile();

console.log(compiled);
```

You may never need this function. Use it if and when you want to see the SQL that would be executed by the `run` function, without in fact executing it.

=> core.ts runResultTransform: (qr: pg.QueryResult) => any = qr => qr.rows;

#### `runResultTransform: (qr: pg.QueryResult) => any`

When you call `run`, the function stored in this property is applied to the `QueryResult` object returned by `pg`, in order to produce the result that the `run` function ultimately returns.

By default, the `QueryResult`’s `rows` property (which is an array) is returned: that is, the default implementation is just `qr => qr.rows`. However, the [shortcut functions](/joins-and-shortcuts#shortcut-functions-and-lateral-joins) supply their own `runResultTransform` implementations in order to match their declared `RunResult` types.

Generally you will not need to call this function directly, but there may be cases where you want to assign a new function to replace the default implementation.

For example, imagine we wanted to create a function returning a query that, when run, returns the current database timestamp directly as a `Date`. We could do so like this:

```typescript
function dbNowQuery() {
  const query = db.sql<never, Date>`SELECT now()`;
  query.runResultTransform = (qr) => qr.rows[0].now;
  return query;
}

const dbNow = await dbNowQuery().run(pool);
// dbNow is a Date: the result you can toggle below has come via JSON.stringify
```

Note that the `RunResult` type variable on the `sql` template function (in this case, `Date`) must reflect the type of the _transformed_ result, not what comes straight back from `pg` (which in this case is roughly `{ rows: [{ now: Date }] }`).

If a `SQLFragment` does not have `run` called on it directly — for example, if it is instead interpolated into another `SQLFragment`, or given as the value of the `lateral` option to the `select` shortcut — then the `runResultTransform` function is never applied.

