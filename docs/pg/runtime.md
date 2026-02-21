---
outline: deep
---

# pg Runtime API

Import pg runtime APIs from:

```ts
import * as db from "@brand-map/postgres/pg"
import pg from "pg"
```

## What It Exports

- Transaction helpers (`transaction`, `serializable`, etc.)
- Shortcut query helpers (`select`, `insert`, `update`, `upsert`, etc.)
- `conditions` namespace
- `db` namespace (`sql`, `param`, `raw`, `parent`, `self`, etc.)
- pg JSON helpers from shared custom JSON handling

## Example

```ts
import * as db from "@brand-map/postgres/pg"
import pg from "pg"

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const users = await db.select("users", db.all).run(pool)
await db.serializable(pool, async txn => {
  await db.insert("auditLog", { message: "created user" }).run(txn)
})
```
