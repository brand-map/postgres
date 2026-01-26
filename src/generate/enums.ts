import { pascalCase } from "es-toolkit";
import type * as pg from "pg";

export type EnumData = { [k: string]: string[] };

export async function enumDataForSchema(schemaName: string, queryFn: (q: pg.QueryConfig) => Promise<pg.QueryResult<any>>): Promise<EnumData> {
  const { rows } = await queryFn({
    text: `--sql
        SELECT
          n.nspname AS schema
        , t.typname AS name
        , e.enumlabel AS value
        FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_enum e ON t.oid = e.enumtypid
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = $1
        ORDER BY t.typname ASC, e.enumlabel ASC`,
    values: [schemaName],
  });

  const enums: EnumData = {};

  for (const row of rows as { name: string; value: string }[]) {
    if (!enums[row.name]) {
      enums[row.name] = [];
    }
    enums[row.name]!.push(row.value);
  }

  return enums;
}

export function enumTypesForEnumData(enums: EnumData) {
  const types = Object.keys(enums)
    .map(
      (name) => `
export type ${pascalCase(name)} = ${enums[name]!.map((v) => `'${v}'`).join(" | ")};
export namespace every {
  export type ${pascalCase(name)} = [${enums[name]!.map((v) => `'${v}'`).join(", ")}];
}`,
    )
    .join("");

  return types;
}
