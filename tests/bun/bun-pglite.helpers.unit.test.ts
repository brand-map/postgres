import { describe, expect, test } from "bun:test"

import { createBunPgliteFixture } from "../shared/bun-pglite.helpers"

describe("bun pglite fixture helper", () => {
  test("cleans up setup resources when migration bootstrap fails", async () => {
    await expect(
      createBunPgliteFixture("bm_fixture_fail", {
        runMigrationsFn: async () => {
          throw new Error("forced migration failure")
        }
      })
    ).rejects.toThrow("forced migration failure")
  })

  test("close tolerates cleanup failures from drop/close calls", async () => {
    const fixture = await createBunPgliteFixture("bm_fixture_close_errors")

    ;(fixture.bunSql as any).unsafe = async () => {
      throw new Error("forced drop failure")
    }
    ;(fixture.bunSql as any).close = async () => {
      throw new Error("forced sql close failure")
    }

    await expect(fixture.close()).resolves.toBeUndefined()
  })
})
