---
outline: deep
---

# pg Generation API

Import pg generator APIs from:

```ts
import * as zg from "@brand-map/postgres/pg/generate"
```

## What It Exports

- `Config`, `CompleteConfig`, and related config types
- `finaliseConfig(...)`
- `tsForConfig(...)`
- `generate(...)`

## Example

```ts
import * as zg from "@brand-map/postgres/pg/generate"

await zg.generate({
  client: "pg",
  config: { connectionString: process.env.DATABASE_URL! },
  outDir: "./src",
  schemas: { public: { include: "*", exclude: [] } },
  debugListener: false,
  progressListener: false,
  warningListener: false
})
```

## CLI Config Reminder

For pg generation in `brand-map-postgres.config.json`, set:

```json
{
  "client": "pg",
  "config": {
    "connectionString": "postgresql://localhost:5432/postgres"
  }
}
```
