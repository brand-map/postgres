---
outline: deep
---

# Database Clients

Use the package path that matches your runtime:

- `@brand-map/postgres/pg` and `@brand-map/postgres/pg` for `pg`
- `@brand-map/postgres/bun` and `@brand-map/postgres/bun` for Bun SQL

You can also import Bun namespaces from `@brand-map/postgres/bun`.

## Runtime Queries

### pg runtime path

```ts
import * as db from "@brand-map/postgres/pg"
import pg from "pg"

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
await db.select("users", db.all).run(pool)
```

### Bun SQL runtime path

```ts
import * as db from "@brand-map/postgres/bun"
import { SQL } from "bun"

const bunSql = new SQL(process.env.DATABASE_URL!)
await db.select("users", db.all).run(bunSql)
```

## Transactions

### pg transaction path

```ts
import * as db from "@brand-map/postgres/pg"

await db.serializable(pool, async transactionClient => {
  await db.insert("auditLog", { message: "pg transaction" }).run(transactionClient)
})
```

### Bun SQL transaction path

```ts
import * as db from "@brand-map/postgres/bun"

await db.serializable(bunSql, async transactionClient => {
  await db.insert("auditLog", { message: "bun sql transaction" }).run(transactionClient)
})
```

## Schema Generation

### pg generator path

```ts
import * as zg from "@brand-map/postgres/pg"

await zg.generate({
  client: "pg",
  config: { connectionString: process.env.DATABASE_URL }
})
```

### Bun SQL generator path

```ts
import * as zg from "@brand-map/postgres/bun"

await zg.generate({
  client: "bun",
  options: process.env.DATABASE_URL!
})
```

Or through the Bun namespace export:

```ts
import * as bunPg from "@brand-map/postgres/bun"

await bunPg.generate.generate({
  client: "bun",
  options: process.env.DATABASE_URL!
})
```
