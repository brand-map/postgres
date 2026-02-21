---
outline: deep
---

# Getting Started

### Install it

First: check your `tsconfig.json`. You need `"strictNullChecks": true` or `"strict": true` (which implies `"strictNullChecks": true`). Without `strictNullChecks`, some things just won't work — namely, the `lateral`, `extras`, `returning` and `columns` options to the shortcut functions.

Since TypeScript 4.4, it's [also a good idea to set `"exactOptionalPropertyTypes": true`](https://github.com/jawj/zapatos/issues/97).

Then install @brand-map/postgres with `bun`:

```bash
bun add @brand-map/postgres
```

### Configure it

Add a top-level file `brand-map-postgres.config.json` to your project. Here's an example:

```json
{
  "client": "pg",
  "config": {
    "connectionString": "postgresql://localhost/example_db"
  },
  "outDir": "./src"
}
```

For runtime usage (`.run(...)` and transactions), see:

- [Bun Runtime API](/bun/runtime)
- [pg Runtime API](/pg/runtime)

These are available top-level keys, all of which are optional:

- `"client"` selects the generator client.
  Use `"pg"` for `@brand-map/postgres/pg` and `"bun"` for `@brand-map/postgres/bun`.

- `"config"` gives connection details for `"client": "pg"`.
  Provide anything accepted by [`new pg.Pool(...)`](https://node-postgres.com/features/connecting/#Programmatic).

- `"options"` gives connection details for `"client": "bun"`.
  Provide a connection string or Bun SQL options accepted by `new SQL(...)`.

- `"outDir"` defines where generated files are written, relative to the project root. If not specified, it defaults to the project root, i.e. `"."`.

- `"outExt"` defines the file extension for all generated type files. It defaults to `".d.ts"`, but [for certain use cases you may wish to set it to `".ts"`](https://github.com/jawj/zapatos/issues/53).

- `"progressListener"` is a boolean that determines how chatty the tool is. If `true`, it enumerates its progress in generating the schema. It defaults to `false`. If you [generate your schema programmatically](#programmatic-generation), you can alternatively provide your own listener function.

- `"warningListener"` is a boolean that determines whether or not the tool logs a warning when a new user-defined type or domain is encountered and given its own type file in `@brand-map/postgres/custom`. If `true`, which is the default, it does. Again, if you [generate your schema programmatically](#programmatic-generation), you can alternatively provide your own listener function.

- `"customTypesTransform"` is a string that determines how user-defined Postgres type names are mapped to TypeScript type names. Your options are `"my_type"`, `"PgMyType"` or `"PgMy_type"`, each representing how a Postgres type named `my_type` will be transformed. The default (for reasons of backward-compatibility rather than superiority) is `"PgMy_type"`. If you [generate your schema programmatically](#programmatic-generation), you can alternatively define your own transformation function.

- `"schemas"` is an object that lets you define the schemas, and the tables and views within schemas, for which types will be generated. Each key is a schema name, and each value is an object with keys `"include"` and `"exclude"`. Those keys can take the value `"*"` (for all tables in the schema) or an array of table names. The `"exclude"` list takes precedence over the `"include"` list. Thanks to generous sponsorship by [Seam](https://www.seam.co/), schemas are [properly supported](https://github.com/jawj/zapatos/issues/3#issuecomment-1126933350) (via namespacing of types) as of version 6.

If not specified, the default value for `"schemas"` includes all tables in the `public` schema, i.e.:

```json
"schemas": {
  "public": {
    "include": "*",
    "exclude": []
  }
}
```

If you use PostGIS, you'll likely want to exclude its system tables:

```json
"schemas": {
  "public": {
    "include": "*",
    "exclude": [
      "geography_columns",
      "geometry_columns",
      "raster_columns",
      "raster_overviews",
      "spatial_ref_sys"
    ]
  }
}
```

- `"unprefixedSchema"` determines which schema's objects don't need to be prefixed with their schema name (so that you can specify table `myTable` rather than `public.myTable`, for example). It should be set to the first schema listed in your Postgres `search_path` that actually exists in the database. Usually, that's `"public"`, which is the option's default value. `"unprefixedSchema"` can also be set to `null`, in which case all objects will be prefixed. That's necessary if any schema shares its name with any table in the `public` schema.

- `"columnOptions"` is an object mapping options to named columns of named (or all) tables. Currently, you can use it to manually exclude column keys from the `Insertable` and `Updatable` types, using the options `"insert": "excluded"` and `"update": "excluded"`, or to force column keys to be optional in `Insertable` types, using the option `"insert": "optional"`. This supports use cases where columns are set using triggers.

For example, say you have a `BEFORE INSERT` trigger on your `customers` table that can guess a default value for the `gender` column based on the value of the `title` column (though note: [don't do that](https://design-system.service.gov.uk/patterns/gender-or-sex/)). In this case, the `gender` column is actually optional on insert, even if it's `NOT NULL` with no default, because the trigger provides a default value. You can tell @brand-map/postgres about that like so:

```json
"columnOptions": {
  "customers": {
    "gender": {
      "insert": "optional"
    }
  }
}
```

Note that tables outside the `public` schema (or whichever schema you set for `"unprefixedSchema"`) should be schema-prefixed here, as usual — e.g. `"columnOptions": { "someSchema.someTable": /* ... */ } }`.

You can also use `"*"` as a wildcard to match all tables in all schemas. For example, perhaps you've set up the appropriate triggers to keep `updatedAt` columns up to date throughout your database. Then you might choose to exclude all your `updatedAt` columns from the `Insertable` and `Updatable` types for all tables as follows:

```json
"columnOptions": {
  "*": {
    "updatedAt": {
      "insert": "excluded",
      "update": "excluded"
    }
  }
}
```

Wildcard table options have lower precedence than named table options. The default values, should you want to restore them for named tables, are `"insert": "auto"` and `"update": "auto"`. Note that `"*"` is only supported as the whole key — you can't use a `*` to match parts of schema or table names — and isn't supported for column names.

- `"schemaJSDoc"` is a boolean that turns JSDoc comments for each column in the generated schema on (the default) or off. JSDoc comments enable per-column VS Code pop-ups giving details of Postgres data type, default value and so on. They also make the schema file longer and less readable.

- `"customJsonParsingForLargeNumbers"` is a boolean that changes the types for `bigint`/`int8` and `numeric`/`decimal` values to reflect the use of [custom JSON parsing to maintain precision](/runtime-configuration#casting-parameters-to-json).

In summary, the expected structure is defined like so:

```typescript:norun
export interface OptionalConfig {
  client: 'pg' | 'bun';
  config?: string | URL | Record<string, unknown>;
  options?: string | Record<string, unknown>;
  outDir: string;
  outExt: string;
  schemas: SchemaRules;
  unprefixedSchema: string | null;
  progressListener: boolean | ((s: string) => void);
  warningListener: boolean | ((s: string) => void);
  customTypesTransform: 'PgMy_type' | 'my_type' | 'PgMyType' | ((s: string) => string);
  columnOptions: ColumnOptions;
  schemaJSDoc: boolean;
  customJsonParsingForLargeNumbers: boolean;
}

interface SchemaRules {
  [schema: string]: {
    include: '*' | string[];
    exclude: '*' | string[];
  };
}

interface ColumnOptions {
  [k: string]: {  // table name or '*'
    [k: string]: {  // column name
      insert?: 'auto' | 'excluded' | 'optional';
      update?: 'auto' | 'excluded';
    };
  };
}
```

#### Environment variables

All values in `brand-map-postgres.config.json` can have environment variables (Node's `process.env.SOMETHING`) interpolated via [handlebars](https://handlebarsjs.com/)-style doubly-curly-brackets `{{variables}}`.

This is likely most useful for the database connection details. For example, on Heroku you might configure your database as:

For `client: "pg"`:

```json
"config": {
  "connectionString": "{{DATABASE_URL}}"
}
```

For `client: "bun"`:

```json
"options": "{{DATABASE_URL}}"
```

#### ESLint / tslint

A general configuration suggestion: set up [ESLint](https://typescript-eslint.io/getting-started/) with the rules [`@typescript-eslint/await-thenable`](https://typescript-eslint.io/rules/await-thenable/) and [`@typescript-eslint/no-floating-promises`](https://typescript-eslint.io/rules/no-floating-promises/) (or the now-deprecated [tslint](https://palantir.github.io/tslint/) with [`no-floating-promises`](https://palantir.github.io/tslint/rules/no-floating-promises/) and [`await-promise`](https://palantir.github.io/tslint/rules/await-promise/)) to avoid various `Promise`-related pitfalls.

### Generate your schema

@brand-map/postgres provides a command line tool. With everything configured, run it like so:

    bunx @brand-map/postgres

This generates the TypeScript schema for your database as `brand-map-postgres.schema.d.ts` inside your configured `outDir`. Any user-defined or domain types encountered get defined within `custom/*.d.ts`, which you can subsequently customise.

These files must be included in your TypeScript compilation. That may happen for you automatically, but you may need to check the `"include"` or `"files"` keys in `tsconfig.json`. If you use `ts-node` or `node -r ts-node/register`, you may need to change it to `ts-node --files` or set `TS_NODE_FILES=true`.

#### Programmatic generation

As an alternative to the command line tool, it's also possible to generate the schema programmatically by importing from `@brand-map/postgres/pg/generate`. For example:

```typescript:norun
import * as zg from '@brand-map/postgres/pg/generate';

const zapCfg: zg.Config = {
  client: 'pg',
  config: { connectionString: 'postgres://localhost/mydb' },
};
await zg.generate(zapCfg);
```

Using Bun SQL for generation:

```typescript:norun
import * as bz from '@brand-map/postgres/bun/generate';

await bz.generate({
  client: 'bun',
  options: process.env.DATABASE_URL!,
});
```

Call the `generate` method with an object structured exactly the same as `brand-map-postgres.config.json`, documented above, with the following two exceptions:

- The `"progressListener"` and `"warningListener"` keys can each take `true` or `false` (as in the JSON case), or alternatively a function with the signature `(s: string) => void`, which you can use to implement your own logging.

- The `"customTypesTransform"` key can take any of the string values allowed in the JSON case, or otherwise a function with the signature `(s: string) => string`, with which you can define your own type name transformation.

#### Custom types and domains

As mentioned previously, any user-defined or domain types encountered during schema generation get defined in their own `.d.ts` files under `@brand-map/postgres/custom`, which you can subsequently customise.

You can use domain types in order to specify custom types on the TypeScript side for certain Postgres columns. Say, for example, that you have a Postgres `jsonb` column on which you want to impose a particular structure. You could do the following:

```sql
CREATE DOMAIN "mySpecialJsonb" AS "jsonb";
```

Since you've done nothing else with this domain, it's effectively just a simple alias to `jsonb` on the Postgres side. Now you can use that in place of `jsonb` in your table definition:

```sql
ALTER TABLE "myTable" ALTER COLUMN "myExistingJsonbColumn" TYPE "mySpecialJsonb";
```

When you next regenerate the TypeScript schema, you'll find a custom type for `PgMySpecialJsonb` in `@brand-map/postgres/custom/PgMySpecialJsonb.d.ts`, defined like so:

```typescript:norun
export type PgMySpecialJsonb = db.JsonValue;
```

You can of course replace this definition with whatever TypeScript type or interface you choose. The file will not be overwritten on future schema generations. For example, perhaps this column holds blog article data:

```typescript:norun
export interface PgMySpecialJsonb {
  title: string;
  text: string;
  tags: string[];
  version: number;
};
```

### Import it

In your code, get the core library like so:

```typescript:norun
import * as db from '@brand-map/postgres/pg';
```

For Bun SQL-specific runtime APIs:

```typescript:norun
import * as db from '@brand-map/postgres/bun';
```

ESM wrappers are provided, so the import should work the same whether your project is set to use the CommonJS or ESM module specs.

To import your ordinary schema types (`myTable.Selectable`, `myOtherTable.Insertable`, etc.):

```typescript:norun
import type * as s from '@brand-map/postgres/schema';
```

Be sure to `import type` for this, not plain `import`, or you'll upset `ts-jest` and maybe others.

To import any user-defined or domain types:

```typescript:norun
import type * as c from '@brand-map/postgres/custom';
```

The paths `@brand-map/postgres/pg`, `@brand-map/postgres/pg/generate`, `@brand-map/postgres/bun`, and `@brand-map/postgres/bun/generate` point to real exports in `node_modules`. Although they look like file paths, `@brand-map/postgres/schema` and `@brand-map/postgres/custom` are ambient modules declared in generated files in your source tree: `brand-map-postgres.schema.d.ts` and `custom/*.d.ts`.
