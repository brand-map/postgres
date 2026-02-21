import { describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import * as pg from "pg"

import { generate as generateBun } from "../../src/bun/generate/write"
import { assertExpectedGeneratedOutput, quoteIdentifier, randomSchemaName, runMigrations, type SeedUser, withPgliteServer } from "../shared/generate.integration.helpers"

function assertExpectedSeedData(users: SeedUser[]) {
  expect(users).toEqual([
    { email: "alice@example.com", display_name: "Alice", role: "admin" },
    { email: "bob@example.com", display_name: "Bob", role: "member" }
  ])
}

async function runBunGenerationWithPglite(connectionString: string) {
  const schemaName = randomSchemaName("bm_pglite_bun")
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-map-postgres-pglite-bun-"))
  let client: pg.Client | undefined

  try {
    client = new pg.Client({ connectionString })
    await client.connect()

    await runMigrations(schemaName, async sqlText => {
      await client!.query(sqlText)
    })

    const usersResult = await client.query<SeedUser>(`SELECT email, display_name, role FROM ${quoteIdentifier(schemaName)}.users ORDER BY id ASC`)
    assertExpectedSeedData(usersResult.rows)

    await client.end()
    client = undefined

    await generateBun({
      client: "bun",
      options: {
        url: connectionString,
        max: 1
      },
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
    await client?.end().catch(() => undefined)

    const cleanupClient = new pg.Client({ connectionString })
    await cleanupClient.connect()
    await cleanupClient.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`).catch(() => undefined)
    await cleanupClient.end().catch(() => undefined)

    fs.rmSync(outDir, { recursive: true, force: true })
  }
}

describe("generate integration (pglite bun)", () => {
  test("runs full flow with Bun SQL generator against pglite", async () => {
    await withPgliteServer(async connectionString => {
      await runBunGenerationWithPglite(connectionString)
    })
  }, 90_000)
})
