import { describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import { SQL } from "bun"

import { generate as generateBun } from "../../src/bun/generate/write"
import { assertExpectedGeneratedOutput, quoteIdentifier, randomSchemaName, runMigrations, type SeedUser } from "../shared/generate.integration.helpers"

const databaseUrl = process.env.BRAND_MAP_POSTGRES_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL
const integrationTest = databaseUrl ? test : test.skip

function assertExpectedSeedData(users: SeedUser[]) {
  expect(users).toEqual([
    { email: "alice@example.com", display_name: "Alice", role: "admin" },
    { email: "bob@example.com", display_name: "Bob", role: "member" }
  ])
}

async function runBunGenerationFlow(connectionString: string) {
  const schemaName = randomSchemaName("bm_it_bun")
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-map-postgres-integration-bun-sql-"))
  const bunSql = new SQL(connectionString)

  try {
    await runMigrations(schemaName, async sqlText => {
      await bunSql.unsafe(sqlText).simple()
    })

    const users = await bunSql.unsafe<SeedUser[]>(`SELECT email, display_name, role FROM ${quoteIdentifier(schemaName)}.users ORDER BY id ASC`)
    assertExpectedSeedData(users)

    await generateBun({
      client: "bun",
      options: { url: connectionString },
      outDir,
      schemas: {
        [schemaName]: { include: "*", exclude: [] }
      },
      unprefixedSchema: null,
      progressListener: false,
      warningListener: false,
      debugListener: false
    })

    assertExpectedGeneratedOutput(fs.readFileSync, fs.existsSync, outDir, schemaName)
  } finally {
    await bunSql.unsafe(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`).catch(() => undefined)
    await bunSql.close().catch(() => undefined)
    fs.rmSync(outDir, { recursive: true, force: true })
  }
}

describe("generate integration (bun)", () => {
  integrationTest("runs full flow with Bun SQL (migrate -> fetch -> generate)", async () => {
    await runBunGenerationFlow(databaseUrl!)
  })

  if (!databaseUrl) {
    test.skip("requires BRAND_MAP_POSTGRES_TEST_DATABASE_URL (or TEST_DATABASE_URL) to run integration checks", () => {})
  }
})
