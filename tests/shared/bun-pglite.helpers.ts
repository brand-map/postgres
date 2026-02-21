import { SQL } from "bun"
import pg from "pg"

import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"

import { quoteIdentifier, randomSchemaName, runMigrations } from "./generate.integration.helpers"

export type BunPgliteFixture = {
  connectionString: string
  schemaName: string
  schemaSql: string
  usersTable: `${string}.users`
  postsTable: `${string}.posts`
  usersTableSql: string
  postsTableSql: string
  pglite: PGlite
  bunSql: SQL
  reset: () => Promise<void>
  close: () => Promise<void>
}

type BunPgliteFixtureOptions = {
  runMigrationsFn?: typeof runMigrations
}

export async function createBunPgliteFixture(prefix: string, options: BunPgliteFixtureOptions = {}): Promise<BunPgliteFixture> {
  const db = await PGlite.create()
  const server = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: 0
  })

  await server.start()

  const [host, portText] = server.getServerConn().split(":")
  const connectionString = `postgresql://postgres:postgres@${host}:${portText}/postgres`
  const bunSql = new SQL({ url: connectionString, max: 1 })

  const schemaName = randomSchemaName(prefix)
  const schemaSql = quoteIdentifier(schemaName)
  const usersTable = `${schemaName}.users` as const
  const postsTable = `${schemaName}.posts` as const
  const usersTableSql = `${schemaSql}.${quoteIdentifier("users")}`
  const postsTableSql = `${schemaSql}.${quoteIdentifier("posts")}`
  const runMigrationsFn = options.runMigrationsFn ?? runMigrations

  async function reset() {
    await bunSql.unsafe(`TRUNCATE TABLE ${postsTableSql}, ${usersTableSql} RESTART IDENTITY CASCADE`)
    await bunSql.unsafe(`
      INSERT INTO ${usersTableSql} (email, display_name, role)
      VALUES
        ('alice@example.com', 'Alice', 'admin'),
        ('bob@example.com', 'Bob', 'member')
    `)
    await bunSql.unsafe(`
      INSERT INTO ${postsTableSql} (user_id, title)
      VALUES
        (1, 'Post 1'),
        (2, 'Post 2')
    `)
  }

  try {
    const client = new pg.Client({ connectionString })
    await client.connect()
    try {
      await runMigrationsFn(schemaName, async sqlText => {
        await client.query(sqlText)
      })
    } finally {
      await client.end().catch(() => undefined)
    }

    await reset()

    return {
      connectionString,
      schemaName,
      schemaSql,
      usersTable,
      postsTable,
      usersTableSql,
      postsTableSql,
      pglite: db,
      bunSql,
      reset,
      close: async () => {
        await bunSql.unsafe(`DROP SCHEMA IF EXISTS ${schemaSql} CASCADE`).catch(() => undefined)
        await bunSql.close().catch(() => undefined)
        await server.stop().catch(() => undefined)
        await db.close().catch(() => undefined)
      }
    }
  } catch (err) {
    await bunSql.close().catch(() => undefined)
    await server.stop().catch(() => undefined)
    await db.close().catch(() => undefined)
    throw err
  }
}
