---
outline: deep
---

# Runtime API Examples

Examples below use the runtime entrypoint:

```ts
import * as db from "@brand-map/postgres/pg"
```

`run(...)` accepts either a `pg` queryable (`Pool`/`Client`) or Bun SQL (`new SQL(...)`).

## Insert

```ts
const [author] = await db.insert("authors", { name: "Ursula K. Le Guin" }).run(pool)
```

## Select

```ts
const authors = await db
  .select("authors", db.all, {
    order: { by: "id", direction: "ASC" }
  })
  .run(pool)
```

## Update

```ts
const updated = await db.update("authors", { name: "U. K. Le Guin" }, { id: 1 }).run(pool)
```

## Transaction

```ts
await db.serializable(pool, async transactionClient => {
  await db.insert("auditLog", { message: "transaction started" }).run(transactionClient)
})
```

## Raw SQL Fragment

```ts
const rows = await db.sql`SELECT now() AS ts`.run(pool)
```
