import type { CompleteConfig } from "../../src/bun/generate-config"

import { describe, expect, test } from "bun:test"
import { SQL } from "bun"
import pg from "pg"

import { tsForConfig } from "../../src/bun/generate-ts-output"
import { quoteIdentifier, randomSchemaName, runMigrations, withPgliteServer } from "../shared/generate.integration.helpers"

const baseConfig = (schemaName: string, options: unknown): CompleteConfig => ({
  client: "bun",
  options: options as CompleteConfig["options"],
  outDir: ".",
  outExt: ".d.ts",
  schemas: { [schemaName]: { include: "*", exclude: [] } },
  debugListener: false,
  progressListener: false,
  warningListener: false,
  customTypesTransform: "my_type",
  columnOptions: {},
  schemaJSDoc: true,
  unprefixedSchema: null,
  customJsonParsingForLargeNumbers: false
})

describe("bun generate-ts-output", () => {
  test("normalises connectionString options and supports unprefixed schema generation", async () => {
    const schemaName = "bm_unit_schema"
    let ctorOptions: unknown

    class FakeSQL {
      constructor(options: unknown) {
        ctorOptions = options
      }

      async unsafe(queryText: string) {
        if (queryText.includes("FROM information_schema.tables")) {
          return []
        }

        if (queryText.includes("FROM pg_catalog.pg_type t")) {
          return []
        }

        throw new Error(`Unexpected test query: ${queryText}`)
      }

      async close() {}
    }

    const config: CompleteConfig = {
      ...baseConfig(schemaName, { connectionString: "postgresql://fake-host/postgres" }),
      unprefixedSchema: schemaName
    }

    const { ts } = await tsForConfig(
      config,
      () => undefined,
      {
        loadBunModule: async () => ({ SQL: FakeSQL as any })
      }
    )

    expect(ctorOptions).toBe("postgresql://fake-host/postgres")
    expect(ts).toContain(`/* === schema: ${schemaName} === */`)
    expect(ts).toContain(`export namespace ${schemaName} {`)
  })

  test("throws a clear error when bun module import fails", async () => {
    const config = baseConfig("public", { url: "postgresql://example.invalid/postgres" })

    await expect(
      tsForConfig(config, () => undefined, {
        loadBunModule: async () => {
          throw new Error("cannot import bun in this runtime")
        }
      })
    ).rejects.toThrow(`This runtime cannot import module "bun"`)
  })

  test("throws when Bun.SQL constructor is unavailable", async () => {
    const config = baseConfig("public", { url: "postgresql://example.invalid/postgres" })

    await expect(
      tsForConfig(config, () => undefined, {
        loadBunModule: async () => ({})
      })
    ).rejects.toThrow("Bun.SQL is unavailable")
  })

  test("wraps query errors when Bun SQL returns non-array rows and still closes the client", async () => {
    const config = baseConfig("public", { url: "postgresql://example.invalid/postgres" })
    let closed = false

    class FakeSQL {
      async unsafe() {
        return { rows: [] }
      }

      async close() {
        closed = true
      }
    }

    await expect(
      tsForConfig(config, () => undefined, {
        loadBunModule: async () => ({ SQL: FakeSQL as any })
      })
    ).rejects.toThrow("Schema generation query 0 failed: Bun SQL query did not return a row array")

    expect(closed).toBe(true)
  })

  test("wraps non-Error query throws into a useful error message", async () => {
    const config = baseConfig("public", { url: "postgresql://example.invalid/postgres" })

    class FakeSQL {
      async unsafe() {
        throw 123
      }

      async close() {}
    }

    await expect(
      tsForConfig(config, () => undefined, {
        loadBunModule: async () => ({ SQL: FakeSQL as any })
      })
    ).rejects.toThrow("Schema generation query 0 failed: 123")
  })

  test("includes Bun Postgres error metadata in wrapped generation errors", async () => {
    const config = baseConfig("public", { url: "postgresql://example.invalid/postgres" })

    class FakeSQL {
      async unsafe() {
        throw new SQL.PostgresError("deadlock detected", {
          code: "ERR_POSTGRES_SERVER_ERROR",
          errno: "40P01",
          detail: "Process 10 waits for ShareLock",
          hint: "See server log for query details"
        })
      }

      async close() {}
    }

    await expect(
      tsForConfig(config, () => undefined, {
        loadBunModule: async () => ({ SQL: FakeSQL as any })
      })
    ).rejects.toThrow("Schema generation query 0 failed: ERR_POSTGRES_SERVER_ERROR (SQLSTATE 40P01): deadlock detected")
  })

  test("returns schema TS and custom type source files for Bun SQL config", async () => {
    await withPgliteServer(async connectionString => {
      const schemaName = randomSchemaName("bm_unit_bun_ts")

      const pgClient = new pg.Client({ connectionString })
      await pgClient.connect()
      try {
        await runMigrations(schemaName, async sqlText => {
          await pgClient.query(sqlText)
        })
        await pgClient.end()

        const debugLogs: string[] = []
        const config: CompleteConfig = baseConfig(schemaName, { url: connectionString, max: 1 })

        const { ts, customTypeSourceFiles } = await tsForConfig(config, message => debugLogs.push(message))

        expect(ts).toContain("declare module '@brand-map/postgres/schema'")
        expect(ts).toContain(`export namespace ${schemaName} {`)
        expect(ts).toContain("export namespace Users {")
        expect(ts).toContain("export namespace Posts {")
        expect(ts).toContain("import type * as db from '@brand-map/postgres/bun';")

        expect(Object.keys(customTypeSourceFiles)).toContain("email_address")
        expect(customTypeSourceFiles.email_address).toContain("declare module '@brand-map/postgres/custom'")
        expect(customTypeSourceFiles.email_address).toContain("export type email_address = string;")
        expect(debugLogs.length).toBeGreaterThan(0)
      } finally {
        await pgClient.end().catch(() => undefined)

        const cleanupClient = new pg.Client({ connectionString })
        await cleanupClient.connect()
        await cleanupClient.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`).catch(() => undefined)
        await cleanupClient.end().catch(() => undefined)
      }
    })
  }, 90_000)
})
