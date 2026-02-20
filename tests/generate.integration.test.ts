import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as pg from "pg";

import { generate } from "../src/generate/write";

// Integration tests need a live Postgres database.
// Example:
// BRAND_MAP_POSTGRES_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres bun test
const databaseUrl = process.env.BRAND_MAP_POSTGRES_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(thisDir, "fixtures", "migrations");

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function randomSchemaName() {
  return `bm_it_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function runMigrations(client: pg.Client, schemaName: string) {
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const fileName of migrationFiles) {
    const migrationPath = path.join(migrationsDir, fileName);
    const sql = fs.readFileSync(migrationPath, "utf8").replaceAll("__SCHEMA__", schemaName);
    await client.query(sql);
  }
}

describe("generate integration", () => {
  integrationTest("runs migrations, reads seed data, generates expected type files", async () => {
    const schemaName = randomSchemaName();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-map-postgres-integration-"));
    const client = new pg.Client({ connectionString: databaseUrl! });
    let connected = false;

    try {
      await client.connect();
      connected = true;

      await runMigrations(client, schemaName);

      const usersResult = await client.query<{
        email: string;
        display_name: string;
        role: string;
      }>(`SELECT email, display_name, role FROM ${quoteIdentifier(schemaName)}.users ORDER BY id ASC`);

      expect(usersResult.rows).toEqual([
        { email: "alice@example.com", display_name: "Alice", role: "admin" },
        { email: "bob@example.com", display_name: "Bob", role: "member" },
      ]);

      await generate({
        db: { connectionString: databaseUrl! },
        outDir,
        schemas: {
          [schemaName]: { include: "*", exclude: [] },
        },
        unprefixedSchema: null,
        progressListener: false,
        warningListener: false,
        debugListener: false,
      });

      const schemaFilePath = path.join(outDir, "brand-map-postgres.schema.d.ts");
      const customDirPath = path.join(outDir, "custom");
      const customTypePath = path.join(customDirPath, "email_address.d.ts");
      const customIndexPath = path.join(customDirPath, "index.d.ts");

      expect(fs.existsSync(schemaFilePath)).toBe(true);
      expect(fs.existsSync(customTypePath)).toBe(true);
      expect(fs.existsSync(customIndexPath)).toBe(true);

      const generatedSchema = fs.readFileSync(schemaFilePath, "utf8");
      expect(generatedSchema).toContain(`export namespace ${schemaName} {`);
      expect(generatedSchema).toContain("export type UserRole = 'admin' | 'member';");
      expect(generatedSchema).toContain("export namespace Users {");
      expect(generatedSchema).toContain("export namespace Posts {");
      expect(generatedSchema).toContain("displayName");
      expect(generatedSchema).toContain("userId");
      expect(generatedSchema).toContain("c.email_address");

      const customTypeSource = fs.readFileSync(customTypePath, "utf8");
      expect(customTypeSource).toContain("declare module '@brand-map/postgres/custom'");
      expect(customTypeSource).toContain("export type email_address = string;");

      const customIndexSource = fs.readFileSync(customIndexPath, "utf8");
      expect(customIndexSource).toContain("declare module '@brand-map/postgres/custom' { }");
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
