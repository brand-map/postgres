---
outline: deep
---

# Utility Types

### Utility types

@brand-map/postgres provides a few over-arching types designed to help you comprehensively enumerate the objects in your database. All of these are literal string array types, in alphabetical order — e.g. `["myTable1", "myTable2", "myTable3", "otherSchema.myTable1"]` — and are as follows:

- `AllSchemas`: schema names
- `AllBaseTables`: ordinary tables, originating from `CREATE TABLE`
- `AllForeignTables`: foreign tables, originating from `CREATE FOREIGN TABLE`
- `AllViews`: ordinary views, deriving from `CREATE VIEW`
- `AllMaterializedViews`: materialized views, deriving from `CREATE MATERIALIZED VIEW`
- `AllTablesAndViews`: all of the above combined

These global types list all relevant objects across all schemas. Schema-specific namespaced variants are also available (except, of course, in the case of `AllSchemas`).

For example, all ordinary tables in the `public` schema are listed in `public.AllBaseTables` (this name is prefixed irrespective of the value of the `"unprefixedSchema"` config option). Or all views in a custom schema might be found under `myOtherSchema.AllViews`.

@brand-map/postgres also provides a number of type mappings allowing types to be accessed by table name, which are heavily used by the shortcut functions:

- `SelectableForTable<Table>`
- `JSONSelectableForTable<Table>`
- `WhereableForTable<Table>`
- `InsertableForTable<Table>`
- `UpdatableForTable<Table>`
- `UniqueIndexForTable<Table>`
- `ColumnForTable<Table>`
- `SQLForTable<Table>`

