import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as pg from "pg";

import { generate as generatePg } from "../../src/pg/generate/write";
import { assertExpectedGeneratedOutput, quoteIdentifier, randomSchemaName, runMigrations, type SeedUser } from "../shared/generate.integration.helpers";

const databaseUrl = process.env.BRAND_MAP_POSTGRES_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

function assertExpectedSeedData(users: SeedUser[]) {
  expect(users).toEqual([
    { email: "alice@example.com", display_name: "Alice", role: "admin" },
    { email: "bob@example.com", display_name: "Bob", role: "member" },
  ]);
}

describe("generate integration (pg)", () => {
  integrationTest("runs full flow with pg client (migrate -> fetch -> generate)", async () => {
    const schemaName = randomSchemaName("bm_it_pg");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-map-postgres-integration-pg-"));
    const client = new pg.Client({ connectionString: databaseUrl! });
    let connected = false;

    try {
      await client.connect();
      connected = true;

      await runMigrations(schemaName, async (sqlText) => {
        await client.query(sqlText);
      });

      const usersResult = await client.query<SeedUser>(`SELECT email, display_name, role FROM ${quoteIdentifier(schemaName)}.users ORDER BY id ASC`);
      assertExpectedSeedData(usersResult.rows);

      await generatePg({
        client: "pg",
        config: { connectionString: databaseUrl! },
        outDir,
        schemas: {
          [schemaName]: { include: "*", exclude: [] },
        },
        unprefixedSchema: null,
        progressListener: false,
        warningListener: false,
        debugListener: false,
      });

      assertExpectedGeneratedOutput(fs.readFileSync, fs.existsSync, outDir, schemaName);
    } finally {
      if (connected) {
        await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      }
      await client.end().catch(() => undefined);
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  if (!databaseUrl) {
    test.skip("requires BRAND_MAP_POSTGRES_TEST_DATABASE_URL (or TEST_DATABASE_URL) to run integration checks", () => {});
  }
});
