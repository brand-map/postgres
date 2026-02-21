import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import pg from "pg"

import { getConfig, setConfig } from "../../src/shared/config"
import {
  __DANGEROUS__RawString,
  ALL,
  ColumnNames,
  ColumnValues,
  DEFAULT,
  Parameter,
  ParentColumn,
  SELF,
  cols,
  executeQuery,
  isBunSqlQueryable,
  isPgQueryable,
  param,
  parent,
  raw,
  sql,
  strict,
  toBuffer,
  vals
} from "../../src/bun/db-core"
import { IsolationLevel, transaction } from "../../src/bun/db-transaction"
import { createBunPgliteFixture, type BunPgliteFixture } from "../shared/bun-pglite.helpers"
import { withPgliteServer } from "../shared/generate.integration.helpers"

const configBeforeTests = getConfig()
let fixture: BunPgliteFixture

beforeAll(async () => {
  fixture = await createBunPgliteFixture("bm_bun_core")
})

afterEach(() => {
  setConfig(configBeforeTests)
})

afterAll(async () => {
  setConfig(configBeforeTests)
  await fixture.close()
})

describe("bun db-core primitives", () => {
  test("strict returns null for null inputs and transforms non-null values", () => {
    const plusOne = strict((x: number) => x + 1)
    expect(plusOne(null)).toBeNull()
    expect(plusOne(4)).toBe(5)
  })

  test("toBuffer decodes bytea hex strings", () => {
    expect(toBuffer("\\x6162").toString("utf8")).toBe("ab")
  })

  test("helpers construct expected wrapper classes", () => {
    expect(param(1)).toBeInstanceOf(Parameter)
    expect(raw("x")).toBeInstanceOf(__DANGEROUS__RawString)
    expect(cols(["id"])).toBeInstanceOf(ColumnNames)
    expect(vals([1])).toBeInstanceOf(ColumnValues)
    expect(parent("id")).toBeInstanceOf(ParentColumn)
    expect(typeof DEFAULT).toBe("symbol")
    expect(typeof SELF).toBe("symbol")
    expect(typeof ALL).toBe("symbol")
  })
})

describe("bun db-core queryable dispatch", () => {
  test("detects pg-like and bun queryables", () => {
    expect(isPgQueryable(fixture.pglite as any)).toBe(true)
    expect(isPgQueryable(fixture.bunSql as any)).toBe(false)
    expect(isBunSqlQueryable(fixture.bunSql as any)).toBe(true)
    expect(isBunSqlQueryable(fixture.pglite as any)).toBe(false)
  })

  test(
    "executeQuery routes to pg queryable",
    async () => {
      await withPgliteServer(async connectionString => {
        const pgClient = new pg.Client({ connectionString })
        await pgClient.connect()
        try {
          const result = await executeQuery(pgClient as any, { text: "SELECT $1::int AS value", values: [1] })
          expect(result.rows).toEqual([{ value: 1 }])
        } finally {
          await pgClient.end()
        }
      })
    },
    20_000
  )

  test("executeQuery routes to bun unsafe and returns row array", async () => {
    const result = await executeQuery(fixture.bunSql as any, { text: "SELECT $1::int AS value", values: [2] })
    expect(result.rows).toEqual([{ value: 2 }])
  })

  test("executeQuery rejects unsupported queryable", async () => {
    await expect(executeQuery({} as any, { text: "SELECT 1", values: [] })).rejects.toThrow(
      "Unsupported queryable: expected either { query(...) } or { unsafe(...) }"
    )
  })
})

describe("bun db-core SQL compilation and execution", () => {
  test("compiles nested fragments, quoting, raw values and casts", () => {
    const compiled = sql`SELECT ${"users.id"}, ${raw("count(*)")}, ${param([1, 2], true)}, ${param({ x: 1 }, true)}, ${param("hello", "text")}`.compile()

    expect(compiled).toEqual({
      text: 'SELECT "users"."id", count(*), CAST($1 AS "json"), CAST($2 AS "json"), CAST($3 AS "text")',
      values: ["[1,2]", '{"x":1}', "hello"]
    })
  })

  test("sorts object keys for cols()/vals() and supports parent alias", () => {
    const insertCompiled = sql`INSERT INTO ${"users"} (${cols({ b: 2, a: 1 })}) VALUES (${vals({ b: 2, a: 1 })})`.compile()
    expect(insertCompiled).toEqual({
      text: 'INSERT INTO "users" ("a", "b") VALUES ($1, $2)',
      values: [1, 2]
    })

    const parentCompiled = sql`SELECT ${parent("id")}`.copy({ parentTable: "u" }).compile()
    expect(parentCompiled).toEqual({
      text: 'SELECT "u"."id"',
      values: []
    })
  })

  test("throws meaningful errors for invalid self/parent/global interpolations", () => {
    expect(() => sql`${SELF}`.compile()).toThrow("The 'self' column alias has no meaning here")
    expect(() => sql`${parent()}`.compile()).toThrow("The 'parent' table alias has no meaning here")
    expect(() => sql`${globalThis as any}`.compile()).toThrow(
      "Did you use `self` (the global object) where you meant `db.self` (the Zapatos value)? The global object cannot be embedded in a query."
    )
  })

  test("supports prepared names and shallow copy overrides", () => {
    const query = sql`SELECT 1`.prepared("my_query_name")
    expect(query.compile()).toEqual({
      text: "SELECT 1",
      values: [],
      name: "my_query_name"
    })

    const copied = sql`SELECT ${parent("id")}`.copy({ parentTable: "u" })
    expect(copied.compile()).toEqual({
      text: 'SELECT "u"."id"',
      values: []
    })
  })

  test("run transforms Date objects to ISO strings and exposes transaction id to listeners", async () => {
    const observedTransactionIds: Array<number | undefined> = []
    setConfig({
      queryListener: (_query, transactionId) => observedTransactionIds.push(transactionId),
      resultListener: (_result, transactionId) => observedTransactionIds.push(transactionId)
    })

    const outsideResult = await sql<never, Array<{ created_at: string }>>`SELECT now() AS created_at`.run(fixture.bunSql)
    expect(outsideResult[0]?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    await transaction(fixture.bunSql as any, IsolationLevel.ReadCommitted, async transactionClient => {
      const insideResult = await sql<never, Array<{ created_at: string }>>`SELECT now() AS created_at`.run(transactionClient)
      expect(insideResult[0]?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    expect(observedTransactionIds[0]).toBeUndefined()
    expect(observedTransactionIds[1]).toBeUndefined()
    expect(typeof observedTransactionIds[2]).toBe("number")
    expect(observedTransactionIds[2]).toBe(observedTransactionIds[3])
  })

  test("noop fragments bypass query execution unless forced", async () => {
    const query = sql<never, Array<{ value: number }>>`SELECT 1 AS value`
    query.noop = true
    query.noopResult = [{ value: 0 }]

    const skipped = await query.run(fixture.bunSql)
    expect(skipped).toEqual([{ value: 0 }])

    const forced = await query.run(fixture.bunSql, true)
    expect(forced).toEqual([{ value: 1 }])
  })
})
