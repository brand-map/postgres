import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"

import * as dc from "../../src/bun/conditions"
import { parent, param, sql } from "../../src/bun/db-core"
import { count, select, update } from "../../src/bun/db-shortcuts"
import { createBunPgliteFixture, type BunPgliteFixture } from "../shared/bun-pglite.helpers"

function compileOnColumn(fragment: ReturnType<typeof sql>, column = "value") {
  return fragment.compile(undefined, undefined, column)
}

let fixture: BunPgliteFixture

beforeAll(async () => {
  fixture = await createBunPgliteFixture("bm_bun_conditions")
})

beforeEach(async () => {
  await fixture.reset()
})

afterAll(async () => {
  await fixture.close()
})

describe("bun conditions static predicates", () => {
  const unaryCases = [
    ["isNull", dc.isNull, '"value" IS NULL'],
    ["isNotNull", dc.isNotNull, '"value" IS NOT NULL'],
    ["isTrue", dc.isTrue, '"value" IS TRUE'],
    ["isNotTrue", dc.isNotTrue, '"value" IS NOT TRUE'],
    ["isFalse", dc.isFalse, '"value" IS FALSE'],
    ["isNotFalse", dc.isNotFalse, '"value" IS NOT FALSE'],
    ["isUnknown", dc.isUnknown, '"value" IS UNKNOWN'],
    ["isNotUnknown", dc.isNotUnknown, '"value" IS NOT UNKNOWN']
  ] as const

  for (const [name, fragment, expectedText] of unaryCases) {
    test(`${name} compiles correctly`, () => {
      expect(compileOnColumn(fragment)).toEqual({ text: expectedText, values: [] })
    })
  }
})

describe("bun conditions parameterized predicates", () => {
  const binaryCases = [
    ["isDistinctFrom", dc.isDistinctFrom(7), '"value" IS DISTINCT FROM $1'],
    ["isNotDistinctFrom", dc.isNotDistinctFrom(7), '"value" IS NOT DISTINCT FROM $1'],
    ["eq", dc.eq(7), '"value" = $1'],
    ["ne", dc.ne(7), '"value" <> $1'],
    ["gt", dc.gt(7), '"value" > $1'],
    ["gte", dc.gte(7), '"value" >= $1'],
    ["lt", dc.lt(7), '"value" < $1'],
    ["lte", dc.lte(7), '"value" <= $1'],
    ["between", dc.between(1, 9), '"value" BETWEEN ($1) AND ($2)'],
    ["betweenSymmetric", dc.betweenSymmetric(1, 9), '"value" BETWEEN SYMMETRIC ($1) AND ($2)'],
    ["notBetween", dc.notBetween(1, 9), '"value" NOT BETWEEN ($1) AND ($2)'],
    ["notBetweenSymmetric", dc.notBetweenSymmetric(1, 9), '"value" NOT BETWEEN SYMMETRIC ($1) AND ($2)'],
    ["like", dc.like("a%"), '"value" LIKE $1'],
    ["notLike", dc.notLike("a%"), '"value" NOT LIKE $1'],
    ["ilike", dc.ilike("a%"), '"value" ILIKE $1'],
    ["notIlike", dc.notIlike("a%"), '"value" NOT ILIKE $1'],
    ["similarTo", dc.similarTo("a%"), '"value" SIMILAR TO $1'],
    ["notSimilarTo", dc.notSimilarTo("a%"), '"value" NOT SIMILAR TO $1'],
    ["reMatch", dc.reMatch("^a"), '"value" ~ $1'],
    ["reImatch", dc.reImatch("^a"), '"value" ~* $1'],
    ["notReMatch", dc.notReMatch("^a"), '"value" !~ $1'],
    ["notReImatch", dc.notReImatch("^a"), '"value" !~* $1']
  ] as const

  for (const [name, fragment, expectedText] of binaryCases) {
    test(`${name} compiles correctly`, () => {
      expect(compileOnColumn(fragment as ReturnType<typeof sql>)).toEqual({ text: expectedText, values: expect.any(Array) })
    })
  }

  test("predicate helpers preserve pre-wrapped parameters", () => {
    const compiled = compileOnColumn(dc.eq(param(42)))
    expect(compiled).toEqual({
      text: '"value" = $1',
      values: [42]
    })
  })
})

describe("bun conditions collection and boolean helpers", () => {
  test("isIn and isNotIn compile correctly for empty and non-empty arrays", () => {
    expect(compileOnColumn(dc.isIn([1, 2]))).toEqual({ text: '"value" IN ($1, $2)', values: [1, 2] })
    expect(compileOnColumn(dc.isNotIn([1, 2]))).toEqual({ text: '"value" NOT IN ($1, $2)', values: [1, 2] })
    expect(compileOnColumn(dc.isIn([]))).toEqual({ text: "false", values: [] })
    expect(compileOnColumn(dc.isNotIn([]))).toEqual({ text: "true", values: [] })
  })

  test("or/and/not compose whereables and fragments", () => {
    expect(compileOnColumn(dc.or({ id: 1 } as any, dc.eq(2) as any, dc.gt(3) as any, dc.lt(4) as any), "id")).toEqual({
      text: '(("id" = $1) OR "id" = $2 OR "id" > $3 OR "id" < $4)',
      values: [1, 2, 3, 4]
    })

    expect(compileOnColumn(dc.and({ id: 1 } as any, dc.eq(2) as any), "id")).toEqual({
      text: '(("id" = $1) AND "id" = $2)',
      values: [1, 2]
    })

    expect(compileOnColumn(dc.not({ id: 1 } as any), "id")).toEqual({
      text: '(NOT ("id" = $1))',
      values: [1]
    })
  })

  test("array operators support raw arrays and parent columns", () => {
    expect(compileOnColumn(dc.arrayContains([1, 2]), "tags")).toEqual({
      text: '"tags" @> $1',
      values: [[1, 2]]
    })

    expect(dc.arrayContains(parent("tags")).compile(undefined, "users", "tags")).toEqual({
      text: '"tags" @> "users"."tags"',
      values: []
    })

    expect(compileOnColumn(dc.arrayContainedIn([1, 2]), "tags").text).toBe('"tags" <@ $1')
    expect(compileOnColumn(dc.arrayOverlaps([1, 2]), "tags").text).toBe('"tags" && $1')
  })
})

describe("bun conditions date/time and arithmetic helpers", () => {
  test("fromNow compiles with default and explicit interval units", () => {
    expect(dc.fromNow(5).compile()).toEqual({
      text: "now() + $1",
      values: ["5 millisecond"]
    })

    expect(dc.fromNow(-2, "hours").compile()).toEqual({
      text: "now() + $1",
      values: ["-2 hours"]
    })
  })

  test("alias helpers after/before/now map to expected expressions", () => {
    expect(compileOnColumn(dc.after(1), "id")).toEqual({ text: '"id" > $1', values: [1] })
    expect(compileOnColumn(dc.before(1), "id")).toEqual({ text: '"id" < $1', values: [1] })
    expect(dc.now.compile()).toEqual({ text: "now()", values: [] })
  })

  test("add/subtract compile to arithmetic operations", () => {
    expect(compileOnColumn(dc.add(2), "score")).toEqual({ text: '"score" + $1', values: [2] })
    expect(compileOnColumn(dc.subtract(3), "score")).toEqual({ text: '"score" - $1', values: [3] })
  })
})

describe("bun conditions integration (pglite)", () => {
  test("comparison and pattern conditions filter real rows correctly", async () => {
    const usersTable = fixture.usersTable as any

    const eqRows = await select(usersTable, { id: dc.eq(1) } as any).run(fixture.bunSql)
    expect(eqRows).toHaveLength(1)
    expect(eqRows[0]?.email).toBe("alice@example.com")

    const neRows = await select(usersTable, { id: dc.ne(1) } as any).run(fixture.bunSql)
    expect(neRows.map(r => r.email)).toEqual(["bob@example.com"])

    const ilikeRows = await select(usersTable, { email: dc.ilike("%ALICE%") } as any).run(fixture.bunSql)
    expect(ilikeRows).toHaveLength(1)
    expect(ilikeRows[0]?.email).toBe("alice@example.com")

    const betweenRows = await select(usersTable, { id: dc.between(1, 2) } as any).run(fixture.bunSql)
    expect(betweenRows).toHaveLength(2)
  })

  test("boolean combinators and membership conditions work against real DB", async () => {
    const usersTable = fixture.usersTable as any

    const inRows = await select(usersTable, { id: dc.isIn([1, 2]) } as any).run(fixture.bunSql)
    expect(inRows).toHaveLength(2)

    const notInRows = await select(usersTable, { id: dc.isNotIn([1]) } as any).run(fixture.bunSql)
    expect(notInRows).toHaveLength(1)
    expect(notInRows[0]?.email).toBe("bob@example.com")

    const orRows = await select(usersTable, dc.or({ id: 1 } as any, { id: 2 } as any)).run(fixture.bunSql)
    expect(orRows).toHaveLength(2)

    const andRows = await select(usersTable, dc.and({ id: 1 } as any, { email: "alice@example.com" } as any)).run(fixture.bunSql)
    expect(andRows).toHaveLength(1)

    const notRows = await select(usersTable, dc.not({ email: "alice@example.com" } as any)).run(fixture.bunSql)
    expect(notRows).toHaveLength(1)
    expect(notRows[0]?.email).toBe("bob@example.com")
  })

  test("date/time and arithmetic condition helpers execute against pglite", async () => {
    const postsTable = fixture.postsTable as any

    const future = await sql<never, Array<{ ok: boolean }>>`SELECT (${dc.fromNow(1, "second")} > now()) AS ok`.run(fixture.bunSql)
    expect(future[0]?.ok).toBe(true)

    await update(postsTable, { user_id: dc.add(1) } as any, { id: 1 } as any).run(fixture.bunSql)
    const shifted = await count(postsTable, { user_id: dc.eq(2), id: dc.eq(1) } as any).run(fixture.bunSql)
    expect(shifted).toBe(1)

    await update(postsTable, { user_id: dc.subtract(1) } as any, { id: 1 } as any).run(fixture.bunSql)
    const restored = await count(postsTable, { user_id: dc.eq(1), id: dc.eq(1) } as any).run(fixture.bunSql)
    expect(restored).toBe(1)
  })
})
