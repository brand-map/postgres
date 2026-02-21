import type { GeneratorCommonConfig } from "../../src/types"

import { describe, expect, test } from "bun:test"

import { __resetGeneratePostgresTypesStateForTests, tsTypeForPgType } from "../../src/bun/generate-postgres-types"

const enums = {
  custom_status: ["active", "inactive"]
}

const baseConfig = (overrides: Partial<GeneratorCommonConfig> = {}): GeneratorCommonConfig => ({
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
  customJsonParsingForLargeNumbers: false,
  ...overrides
})

describe("bun generate-postgres-types", () => {
  test("warns once for large-number types and maps int8/numeric context variants", () => {
    __resetGeneratePostgresTypesStateForTests()
    const warnings: string[] = []
    const config = baseConfig({
      warningListener: message => warnings.push(message)
    })

    expect(tsTypeForPgType("int8", enums, "Selectable", config)).toBe("db.Int8String")
    expect(tsTypeForPgType("int8", enums, "JsonSelectable", config)).toBe("number")
    expect(tsTypeForPgType("int8", enums, "Insertable", config)).toBe("(number | db.Int8String | bigint)")
    expect(tsTypeForPgType("numeric", enums, "Selectable", config)).toBe("db.NumericString")
    expect(tsTypeForPgType("numeric", enums, "Whereable", config)).toBe("(number | db.NumericString)")
    expect(tsTypeForPgType("numeric", enums, "JsonSelectable", config)).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })

  test("supports warningListener=false fallback warning callback", () => {
    __resetGeneratePostgresTypesStateForTests()
    const config = baseConfig({ warningListener: false })
    expect(tsTypeForPgType("int8", enums, "Selectable", config)).toBe("db.Int8String")
  })

  test("respects custom JSON parsing mode for int8 JSON-selectable values", () => {
    const config = baseConfig({ customJsonParsingForLargeNumbers: true })
    expect(tsTypeForPgType("int8", enums, "JsonSelectable", config)).toBe("(number | db.Int8String)")
  })

  test("maps money and bytea according to context", () => {
    const config = baseConfig()
    expect(tsTypeForPgType("money", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("money", enums, "Insertable", config)).toBe("(number | string)")
    expect(tsTypeForPgType("bytea", enums, "JsonSelectable", config)).toBe("db.ByteArrayString")
    expect(tsTypeForPgType("bytea", enums, "Selectable", config)).toBe("Buffer")
    expect(tsTypeForPgType("bytea", enums, "Insertable", config)).toBe("(db.ByteArrayString | Buffer)")
  })

  test("maps date-like and range-like values to string forms", () => {
    const config = baseConfig()
    expect(tsTypeForPgType("date", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("timestamp", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("timestamptz", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("time", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("timetz", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("int4range", enums, "Selectable", config)).toBe("db.NumberRangeString")
    expect(tsTypeForPgType("int8range", enums, "Selectable", config)).toBe("db.NumberRangeString")
    expect(tsTypeForPgType("numrange", enums, "Selectable", config)).toBe("db.NumberRangeString")
    expect(tsTypeForPgType("tsrange", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("tstzrange", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("daterange", enums, "Selectable", config)).toBe("string")
  })

  test("maps string-like, number-like, bool and json-like primitive types", () => {
    const config = baseConfig()
    expect(tsTypeForPgType("interval", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("bpchar", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("char", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("varchar", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("text", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("citext", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("uuid", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("inet", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("name", enums, "Selectable", config)).toBe("string")
    expect(tsTypeForPgType("int2", enums, "Selectable", config)).toBe("number")
    expect(tsTypeForPgType("int4", enums, "Selectable", config)).toBe("number")
    expect(tsTypeForPgType("float4", enums, "Selectable", config)).toBe("number")
    expect(tsTypeForPgType("float8", enums, "Selectable", config)).toBe("number")
    expect(tsTypeForPgType("oid", enums, "Selectable", config)).toBe("number")
    expect(tsTypeForPgType("bool", enums, "Selectable", config)).toBe("boolean")
    expect(tsTypeForPgType("json", enums, "Selectable", config)).toBe("db.JsonValue")
    expect(tsTypeForPgType("jsonb", enums, "Selectable", config)).toBe("db.JsonValue")
  })

  test("maps enums, arrays, and falls back to any for unknown types", () => {
    const config = baseConfig()
    expect(tsTypeForPgType("custom_status", enums, "Selectable", config)).toBe("CustomStatus")
    expect(tsTypeForPgType("_int4", enums, "Selectable", config)).toBe("number[]")
    expect(tsTypeForPgType("_custom_status", enums, "Selectable", config)).toBe("CustomStatus[]")
    expect(tsTypeForPgType("_unknown_type", enums, "Selectable", config)).toBe("any")
    expect(tsTypeForPgType("unknown_type", enums, "Selectable", config)).toBe("any")
  })

  test("supports warningListener=true mode", () => {
    const original = console.log
    const messages: string[] = []
    console.log = (...args: unknown[]) => {
      messages.push(args.map(String).join(" "))
    }

    try {
      tsTypeForPgType("int8", enums, "Selectable", baseConfig({ warningListener: true }))
    } finally {
      console.log = original
    }

    expect(Array.isArray(messages)).toBe(true)
  })
})
