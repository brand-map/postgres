---
outline: deep
---

# Bun Generation API

Import Bun generator APIs from:

```ts
import * as zg from "@brand-map/postgres/bun/generate"
```

## What It Exports

- `Config`, `CompleteConfig`, and related config types
- `finaliseConfig(...)`
- `tsForConfig(...)`
- `generate(...)`

## Example

```ts
import * as zg from "@brand-map/postgres/bun/generate"

await zg.generate({
  client: "bun",
  options: { url: process.env.DATABASE_URL!, max: 1 },
  outDir: "./src",
  schemas: { public: { include: "*", exclude: [] } },
  debugListener: false,
  progressListener: false,
  warningListener: false
})
```

## CLI Config Reminder

For Bun generation in `brand-map-postgres.config.json`, set:

```json
{
  "client": "bun",
  "options": {
    "url": "postgresql://localhost:5432/postgres"
  }
}
```
