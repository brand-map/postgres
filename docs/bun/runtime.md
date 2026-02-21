---
outline: deep
---

# Bun Runtime API

Import Bun runtime APIs from:

```ts
import * as db from "@brand-map/postgres/bun"
```

## What It Exports

- Transaction helpers (`transaction`, `serializable`, etc.)
- Shortcut query helpers (`select`, `insert`, `update`, `upsert`, etc.)
- `conditions` namespace
- `db` namespace (`sql`, `param`, `raw`, `parent`, `self`, etc.)

## Example

```ts
import { SQL } from "bun"
import * as db from "@brand-map/postgres/bun"

const bunSql = new SQL(process.env.DATABASE_URL!)

const users = await db.select("users", db.all).run(bunSql)
await db.serializable(bunSql, async txn => {
  await db.insert("auditLog", { message: "created user" }).run(txn)
})
```

## Bun Error Handling

When using Bun SQL directly, error types come from `SQL`:

```ts
import { SQL } from "bun"

try {
  await db.sql`SELECT 1`.run(bunSql)
} catch (error) {
  if (error instanceof SQL.PostgresError) {
    console.log(error.code)  // e.g. ERR_POSTGRES_SERVER_ERROR
    console.log(error.errno) // SQLSTATE, e.g. 40001
  }
}
```
