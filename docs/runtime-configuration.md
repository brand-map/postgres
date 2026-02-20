---
outline: deep
---

# Run-time Configuration

### Run-time configuration

There are a few configuration options you can set at runtime:

```typescript:norun
export interface Config {
  transactionAttemptsMax: number;
  transactionRetryDelay: { minMs: number; maxMs: number };
  castArrayParamsToJson: boolean;
  castObjectParamsToJson: boolean;
  queryListener?(query: SQLQuery, txnId?: number): void;
  resultListener?(result: any, txnId?: number, elapsedMs?: number): void;
  transactionListener?(message: string, txnId?: number): void;
}
export interface SQLQuery {
  text: string;
  values: any[];
}
```

Read the current values with `getConfig()` and set new values with `setConfig(newConfig: Partial<Config>)`.

- `transactionAttemptsMax` determines how many times the `transaction` helper will try to execute a query in the face of serialization errors before giving up. It defaults to `5`.

- `transactionRetryDelay` determines the range within which the `transaction` helper will pick a random delay before each retry. It's expressed in milliseconds and defaults to `{ minMs: 25, maxMs: 250 }`.

- `castArrayParamsToJson` and `castObjectParamsToJson` control whether `Parameter` objects containing arrays and objects, respectively, are to be automatically stringified and cast as Postgres `json` when interpolated into a query. Both default to `false`. See further discussion below.

- `queryListener` and `resultListener`, if set, are called from the `run` function, and receive the results of (respectively) compiling and then executing and transforming each query as their first argument. For queries within a transaction, they will be passed a unique numeric transaction ID as their second argument, to aid debugging. The `resultListener` receives a third argument, which is the time the query took (in ms).

- `transactionListener`, similarly, is called with messages about transaction retries, and associated transaction IDs.

You might use one or more of the three listener functions to implement logging. For example, if you're using the [`debug`](https://github.com/visionmedia/debug) library, you could do something like this:

```typescript:norun
const
  queryDebug = debug('db:query'),
  resultDebug = debug('db:result'),
  txnDebug = debug('db:transaction'),
  strFromTxnId = (txnId: number | undefined) => txnId === undefined ? '-' : String(txnId);

db.setConfig({
  queryListener: (query, txnId) =>
    queryDebug(`(%s) %s\n%o`, strFromTxnId(txnId), query.text, query.values),
  resultListener: (result, txnId, elapsedMs) =>
    resultDebug(`(%s, %dms) %O`, strFromTxnId(txnId), elapsedMs?.toFixed(1), result),
  transactionListener: (message, txnId) =>
    txnDebug(`(%s) %s`, strFromTxnId(txnId), message),
});
```

These listeners are also used in generating the _Show generated SQL, results_ elements of this documentation.

#### Casting `Parameters` to JSON

There's [a longstanding gotcha in the `pg` module's treatment of JSON parameters](https://github.com/brianc/node-postgres/issues/2012). For `json` and `jsonb` values, you can pass a JavaScript object directly: `pg` automatically calls `JSON.stringify` for you behind the scenes. But try the same thing with a JavaScript array, and that doesn't happen.

Using `pg` directly here, from Node:

```
> const pg = require('pg');
> const pool = new pg.Pool(/* ... */);
BoundPool { /* ... */ }
> pool.query('INSERT INTO jsontest (data) VALUES ($1)', [{ a: 1, b: 2, c: 3 }]);
Promise { <pending> }
> pool.query('INSERT INTO jsontest (data) VALUES ($1)', [[1, 2, 3]]);
Promise { <pending> }
> (node:59488) UnhandledPromiseRejectionWarning: error: invalid input syntax for type json
```

In this second case, `pg` can't tell whether you're trying to pass a JSON array or a native Postgres array, and it assumes the latter.

But if you know you'll more often be passing JSON arrays than native Postgres arrays to `pg`, you can reverse this assumption by setting the @brand-map/postgres `castArrayParamsToJson` config option to `true`. When interpolating a `Parameter` instance (as returned by the `param` call) that wraps an array, @brand-map/postgres will then default to calling `JSON.stringify` on the array and casting it to `json`. Whether or not `castArrayParamsToJson` is set, you can always specify the desired stringifying and casting behaviour using the [optional second argument to `param`](/sql-and-fragments#paramvalue-any-cast-boolean--string-parameter).

To clarify, take this table:

```sql
CREATE TABLE "arrays" ("jsonValue" jsonb, "textArray" text[]);
```

When `castArrayParamsToJson` is `false` (the default):

```typescript
db.setConfig({ castArrayParamsToJson: false }); // the default

await db
  .insert("arrays", {
    jsonValue: db.param(["a", "b", "c"], true), // true -> manual cast to JSON
    textArray: ["a", "b", "c"],
  })
  .run(pool);
```

Or with `castArrayParamsToJson` set to `true`:

```typescript
db.setConfig({ castArrayParamsToJson: true });

await db
  .insert("arrays", {
    jsonValue: ["a", "b", "c"],
    textArray: db.param(["a", "b", "c"], false), // false -> prevent automatic cast to JSON
  })
  .run(pool);
```

The `castObjectParamsToJson` option has a fairly similar effect. As seen above, `pg` already stringifies JavaScript objects, but it does not explicitly cast them to `json`, and instead passes them implicitly as `text`. This matters in the (probably rare) case that the parameter then requires an onward cast from `json` to another type.

For example, when working with recent PostGIS, casting `geometry` values to JSON produces handy [GeoJSON](https://geojson.org/) output, and you can [define your own cast](https://trac.osgeo.org/postgis/ticket/3687#comment:9) in the opposite direction too. However, when doing a GeoJSON `INSERT` into or `UPDATE` of a `geometry` column, the stringified JSON input parameter must be explicitly cast to JSON, otherwise it's assumed to be [Well-Known Text](https://en.wikipedia.org/wiki/Well-known_text_representation_of_geometry) and fails to parse. In @brand-map/postgres, you can specify the cast manually with the [optional second argument to `param`](/sql-and-fragments#paramvalue-any-cast-boolean--string-parameter), or you can set `castObjectParamsToJson` to `true`, and any JSON objects interpolated as a `Parameter` will be cast to `json` automatically.

