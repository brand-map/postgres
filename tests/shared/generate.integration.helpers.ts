import { expect } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"

const thisDir = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(thisDir, "..", "fixtures", "migrations")

export type SeedUser = {
  email: string
  display_name: string
  role: string
}

export function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

export function randomSchemaName(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function migrationSqlForSchema(schemaName: string, fileName: string) {
  const migrationPath = path.join(migrationsDir, fileName)
  return fs.readFileSync(migrationPath, "utf8").replaceAll("__SCHEMA__", schemaName)
}

export async function runMigrations(schemaName: string, executeSql: (sql: string) => Promise<unknown>) {
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort()

  for (const fileName of migrationFiles) {
    await executeSql(migrationSqlForSchema(schemaName, fileName))
  }
}

export function assertExpectedGeneratedOutput(readFile: (p: string, enc: BufferEncoding) => string, exists: (p: string) => boolean, outDir: string, schemaName: string) {
  const schemaFilePath = path.join(outDir, "brand-map-postgres.schema.d.ts")
  const customDirPath = path.join(outDir, "custom")
  const customTypePath = path.join(customDirPath, "email_address.d.ts")
  const customIndexPath = path.join(customDirPath, "index.d.ts")

  expect(exists(schemaFilePath)).toBe(true)
  expect(exists(customTypePath)).toBe(true)
  expect(exists(customIndexPath)).toBe(true)

  const generatedSchema = readFile(schemaFilePath, "utf8")
  expect(generatedSchema).toContain(`export namespace ${schemaName} {`)
  expect(generatedSchema).toContain("export type UserRole = 'admin' | 'member';")
  expect(generatedSchema).toContain("export namespace Users {")
  expect(generatedSchema).toContain("export namespace Posts {")
  expect(generatedSchema).toContain("displayName")
  expect(generatedSchema).toContain("userId")
  expect(generatedSchema).toContain("c.email_address")

  const customTypeSource = readFile(customTypePath, "utf8")
  expect(customTypeSource).toContain("declare module '@brand-map/postgres/custom'")
  expect(customTypeSource).toContain("export type email_address = string;")

  const customIndexSource = readFile(customIndexPath, "utf8")
  expect(customIndexSource).toContain("declare module '@brand-map/postgres/custom' { }")
}

export async function withPgliteServer(run: (connectionString: string) => Promise<void>) {
  const db = await PGlite.create()
  const server = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: 0
  })

  await server.start()
  const [host, portText] = server.getServerConn().split(":")
  const connectionString = `postgresql://postgres:postgres@${host}:${portText}/postgres`

  try {
    await run(connectionString)
  } finally {
    await server.stop()
    await db.close()
  }
}
