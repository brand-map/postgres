import type { GeneratorCommonConfig } from "../../src/types"

import { describe, expect, test } from "bun:test"

import { cols, param, sql, vals, type PgQueryable } from "../../src/shared/db-core"
import { tsTypeForPgType } from "../../src/shared/generate-postgres-types"

const generatorConfig: GeneratorCommonConfig = {
  outDir: ".",
  outExt: ".d.ts",
  schemas: { public: { include: "*", exclude: [] } },
  debugListener: false,
  progressListener: false,
  warningListener: false,
  customTypesTransform: "my_type",
  columnOptions: {},
  schemaJSDoc: true,
  unprefixedSchema: "public",
  customJsonParsingForLargeNumbers: false
}

describe("date type mapping", () => {
  test("maps date/time-like postgres types to plain string", () => {
    const enums = {}

    expect(tsTypeForPgType("date", enums, "Selectable", generatorConfig)).toBe("string")
    expect(tsTypeForPgType("timestamp", enums, "Selectable", generatorConfig)).toBe("string")
    expect(tsTypeForPgType("timestamptz", enums, "Selectable", generatorConfig)).toBe("string")
    expect(tsTypeForPgType("time", enums, "Selectable", generatorConfig)).toBe("string")
    expect(tsTypeForPgType("timetz", enums, "Selectable", generatorConfig)).toBe("string")
    expect(tsTypeForPgType("daterange", enums, "Selectable", generatorConfig)).toBe("string")
  })
})

describe("date runtime normalization", () => {
  test("converts Date values returned by pg queryables into ISO strings", async () => {
    const createdAt = new Date("2026-02-20T00:00:00.000Z")

    const pgQueryable: PgQueryable = {
      query: async () => ({
        rows: [
          {
            created_at: createdAt,
            nested_value: { updated_at: createdAt },
            created_list: [createdAt]
          }
        ]
      })
    }

    const result = await sql<never, Array<{ created_at: string; nested_value: { updated_at: string }; created_list: string[] }>>`SELECT now() AS created_at`.run(pgQueryable)

    expect(result).toEqual([
      {
        created_at: "2026-02-20T00:00:00.000Z",
        nested_value: { updated_at: "2026-02-20T00:00:00.000Z" },
        created_list: ["2026-02-20T00:00:00.000Z"]
      }
    ])
  })

  test("compiles Date parameters to ISO strings", () => {
    const createdAt = new Date("2026-02-20T12:34:56.000Z")
    const compiled = sql`SELECT ${param(createdAt)}`.compile()

    expect(compiled.values).toEqual(["2026-02-20T12:34:56.000Z"])
  })

  test("compiles Date values nested in object parameters to ISO strings", () => {
    const createdAt = new Date("2026-02-20T12:34:56.000Z")
    const compiled = sql`INSERT INTO ${"events"} (${cols({ createdAt })}) VALUES (${vals({ createdAt })})`.compile()

    expect(compiled.values).toEqual(["2026-02-20T12:34:56.000Z"])
  })
})
