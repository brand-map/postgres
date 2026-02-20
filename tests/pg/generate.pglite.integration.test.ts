import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as pg from "pg";

import { generate as generatePg } from "../../src/pg/generate/write";
import { assertExpectedGeneratedOutput, quoteIdentifier, randomSchemaName, runMigrations, type SeedUser, withPgliteServer } from "../shared/generate.integration.helpers";

function assertExpectedSeedData(users: SeedUser[]) {
  expect(users).toEqual([
    { email: "alice@example.com", display_name: "Alice", role: "admin" },
    { email: "bob@example.com", display_name: "Bob", role: "member" },
  ]);
}

describe("generate integration (pglite pg)", () => {
  test("runs full flow with pg generator against pglite", async () => {
    await withPgliteServer(async (connectionString) => {
      const schemaName = randomSchemaName("bm_pglite_pg");
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-map-postgres-pglite-pg-"));
      let client: pg.Client | undefined;

      try {
        client = new pg.Client({ connectionString });
        await client.connect();

        await runMigrations(schemaName, async (sqlText) => {
          await client!.query(sqlText);
        });

        const usersResult = await client.query<SeedUser>(`SELECT email, display_name, role FROM ${quoteIdentifier(schemaName)}.users ORDER BY id ASC`);
        assertExpectedSeedData(usersResult.rows);

        await client.end();
        client = undefined;

        await generatePg({
          client: "pg",
          config: {
            connectionString,
            max: 1,
            connectionTimeoutMillis: 1_000,
          },
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
        await client?.end().catch(() => undefined);
        const cleanupClient = new pg.Client({ connectionString });
        await cleanupClient.connect();
        await cleanupClient.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`).catch(() => undefined);
        await cleanupClient.end().catch(() => undefined);
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });
  }, 90_000);
});
