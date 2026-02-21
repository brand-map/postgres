import { describe, expect, test } from "bun:test"

import * as bunDb from "../../src/bun/db"
import * as bunGenerate from "../../src/bun/generate"

describe("bun module export surface", () => {
  test("db module exports transaction helpers, db namespace and conditions namespace", () => {
    expect(typeof bunDb.transaction).toBe("function")
    expect(typeof bunDb.serializable).toBe("function")
    expect(typeof bunDb.repeatableRead).toBe("function")
    expect(typeof bunDb.readCommitted).toBe("function")

    expect(typeof bunDb.db.sql).toBe("function")
    expect(typeof bunDb.db.param).toBe("function")
    expect(typeof bunDb.conditions.eq).toBe("function")
    expect(typeof bunDb.conditions.isNull).toBe("object")

    expect(typeof bunDb.insert).toBe("function")
    expect(typeof bunDb.upsert).toBe("function")
    expect(typeof bunDb.select).toBe("function")
  })

  test("generate module re-exports generate entrypoints", () => {
    expect(typeof bunGenerate.generate).toBe("function")
    expect(typeof bunGenerate.finaliseConfig).toBe("function")
    expect(typeof bunGenerate.tsForConfig).toBe("function")
  })
})
