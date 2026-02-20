---
outline: deep
---

# Generator Config Examples

This page shows practical `brand-map-postgres.config.json` examples for schema generation.

## Minimal Config

```json
{
  "db": {
    "connectionString": "{{DATABASE_URL}}"
  }
}
```

## Multi-Schema Config

```json
{
  "db": {
    "connectionString": "{{DATABASE_URL}}"
  },
  "outDir": "./src/generated",
  "schemas": {
    "public": {
      "include": "*",
      "exclude": []
    },
    "analytics": {
      "include": "*",
      "exclude": [
        "internal_rollups"
      ]
    }
  },
  "unprefixedSchema": "public"
}
```

## Recommended Run Command

```bash
bunx @brand-map/postgres
```

## Generated Files

- `brand-map-postgres.schema.d.ts`
- `custom/*.d.ts` (for custom/domain type declarations)
