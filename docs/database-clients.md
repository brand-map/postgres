---
outline: deep
---

# Client Matrix

Use the package path that matches your runtime and task.

## Runtime APIs

- Bun SQL runtime API: `@brand-map/postgres/bun`
- `pg` runtime API: `@brand-map/postgres/pg`

## Generation APIs

- Bun SQL generator API: `@brand-map/postgres/bun/generate`
- `pg` generator API: `@brand-map/postgres/pg/generate`

## Split Docs

- Bun docs: [Bun Overview](/bun/)
- pg docs: [pg Overview](/pg/)

## Notes

- `@brand-map/postgres` (root path) maps to the Bun runtime API for convenience.
- Legacy generator aliases are still exported:
  - `@brand-map/postgres/generate` (Bun generator)
  - `@brand-map/postgres/generate/pg` (pg generator)
