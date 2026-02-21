import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { SQL } from "bun"

import { getConfig, setConfig } from "../../src/shared/config"
import { sql } from "../../src/bun/db-core"
import { insert } from "../../src/bun/db-shortcuts"
import {
  IsolationLevel,
  readCommitted,
  readCommittedReadOnly,
  repeatableRead,
  repeatableReadReadOnly,
  serializable,
  serializableReadOnly,
  serializableReadOnlyDeferrable,
  __setTransactionSequenceForTests,
  transaction
} from "../../src/bun/db-transaction"
import { createBunPgliteFixture, type BunPgliteFixture } from "../shared/bun-pglite.helpers"

const configBeforeTests = getConfig()

let fixture: BunPgliteFixture

beforeAll(async () => {
  fixture = await createBunPgliteFixture("bm_bun_tx")
})

beforeEach(async () => {
  await fixture.reset()
  setConfig(configBeforeTests)
})

afterAll(async () => {
  setConfig(configBeforeTests)
  await fixture.close()
})

describe("bun sql compatibility (integration via pglite)", () => {
  test("sql.run executes against Bun SQL and preserves row keys", async () => {
    const rows = await sql<never, Array<{ snake_case_value: number }>>`SELECT 7 AS snake_case_value`.run(fixture.bunSql)
    expect(rows).toEqual([{ snake_case_value: 7 }])
  })

  test("transaction passes branded client in callback and cleans brand afterwards", async () => {
    let brandedClientRef: { __bmPostgres?: unknown } | undefined

    const result = await transaction(fixture.bunSql as any, IsolationLevel.ReadCommittedReadOnly, async transactionClient => {
      brandedClientRef = transactionClient
      expect(transactionClient.__bmPostgres?.isolationLevel).toBe(IsolationLevel.ReadCommittedReadOnly)
      await sql`SELECT 1`.run(transactionClient)
      return "done"
    })

    expect(result).toBe("done")
    expect(brandedClientRef?.__bmPostgres).toBeUndefined()
  })

  test("transaction rolls back when a query fails", async () => {
    await expect(
      transaction(fixture.bunSql as any, IsolationLevel.Serializable, async transactionClient => {
        await insert(
          fixture.usersTable as any,
          { email: "carol@example.com", display_name: "Carol", role: "member" } as any
        ).run(transactionClient)
        await insert(
          fixture.usersTable as any,
          { email: "alice@example.com", display_name: "Alice duplicate", role: "member" } as any
        ).run(transactionClient)
      })
    ).rejects.toBeDefined()

    const rows = await fixture.bunSql.unsafe<Array<{ email: string }>>(
      `SELECT email FROM ${fixture.usersTableSql} ORDER BY id`
    )
    expect(rows.map(r => r.email)).toEqual(["alice@example.com", "bob@example.com"])
  })

  test("nested transaction uses savepoint semantics so outer transaction can continue", async () => {
    await transaction(fixture.bunSql as any, IsolationLevel.Serializable, async outerTransactionClient => {
      const inserted = await insert(
        fixture.usersTable as any,
        { email: "outer@example.com", display_name: "Outer", role: "member" } as any
      ).run(outerTransactionClient)

      await expect(
        transaction(outerTransactionClient, IsolationLevel.ReadCommitted, async innerTransactionClient => {
          await insert(
            fixture.usersTable as any,
            { email: "alice@example.com", display_name: "Inner duplicate", role: "member" } as any
          ).run(innerTransactionClient)
        })
      ).rejects.toBeDefined()

      await insert(fixture.postsTable as any, { user_id: inserted.id, title: "outer post" } as any).run(outerTransactionClient)
    })

    const users = await fixture.bunSql.unsafe<Array<{ email: string }>>(
      `SELECT email FROM ${fixture.usersTableSql} ORDER BY id`
    )
    expect(users.map(u => u.email)).toEqual(["alice@example.com", "bob@example.com", "outer@example.com"])

    const posts = await fixture.bunSql.unsafe<Array<{ title: string }>>(
      `SELECT title FROM ${fixture.postsTableSql} WHERE title = 'outer post'`
    )
    expect(posts).toEqual([{ title: "outer post" }])
  })

  test("non-retryable errors do not trigger retry log messages", async () => {
    const messages: string[] = []
    setConfig({
      transactionAttemptsMax: 4,
      transactionRetryDelay: { min: 0, max: 0 },
      transactionListener: message => messages.push(message)
    })

    await expect(
      transaction(fixture.bunSql as any, IsolationLevel.Serializable, async transactionClient => {
        await insert(
          fixture.usersTable as any,
          { email: "alice@example.com", display_name: "Duplicate", role: "member" } as any
        ).run(transactionClient)
      })
    ).rejects.toBeDefined()

    expect(messages.some(message => message.includes("Retrying transaction"))).toBe(false)
  })

  test("isolation-level shortcut helpers execute successfully against real DB", async () => {
    await serializable(fixture.bunSql as any, async transactionClient => {
      await sql`SELECT 1`.run(transactionClient)
    })
    await repeatableRead(fixture.bunSql as any, async transactionClient => {
      await sql`SELECT 1`.run(transactionClient)
    })
    await readCommitted(fixture.bunSql as any, async transactionClient => {
      await sql`SELECT 1`.run(transactionClient)
    })
    await serializableReadOnly(fixture.bunSql as any, async transactionClient => {
      await sql`SELECT 1`.run(transactionClient)
    })
    await repeatableReadReadOnly(fixture.bunSql as any, async transactionClient => {
      await sql`SELECT 1`.run(transactionClient)
    })
    await readCommittedReadOnly(fixture.bunSql as any, async transactionClient => {
      await sql`SELECT 1`.run(transactionClient)
    })
    await serializableReadOnlyDeferrable(fixture.bunSql as any, async transactionClient => {
      await sql`SELECT 1`.run(transactionClient)
    })
  })

  test("fault injection retries serialization failures and then succeeds", async () => {
    const messages: string[] = []
    setConfig({
      transactionAttemptsMax: 2,
      transactionRetryDelay: { min: 0, max: 0 },
      transactionListener: message => messages.push(message)
    })

    let beginAttempts = 0
    const faultInjectedQueryable = {
      unsafe: fixture.bunSql.unsafe.bind(fixture.bunSql),
      begin: async (_options: string, callback: (client: any) => Promise<number>) => {
        beginAttempts++
        if (beginAttempts === 1) {
          throw new SQL.PostgresError("serialization failure", {
            code: "ERR_POSTGRES_SERVER_ERROR",
            errno: "40001"
          })
        }
        return callback({ unsafe: fixture.bunSql.unsafe.bind(fixture.bunSql) })
      }
    }

    const value = await transaction(faultInjectedQueryable as any, IsolationLevel.Serializable, async transactionClient => {
      const rows = await sql<never, Array<{ value: number }>>`SELECT 42 AS value`.run(transactionClient)
      return rows[0]!.value
    })

    expect(value).toBe(42)
    expect(beginAttempts).toBe(2)
    expect(messages.some(message => message.includes("ERR_POSTGRES_SERVER_ERROR/40001"))).toBe(true)
    expect(messages.some(message => message.includes("retrying in 0ms"))).toBe(true)
    expect(messages.some(message => message.includes("Retrying transaction, attempt 2 of 2"))).toBe(true)
  })

  test("fault injection gives up after max attempts on retryable rollback", async () => {
    const messages: string[] = []
    setConfig({
      transactionAttemptsMax: 1,
      transactionRetryDelay: { min: 0, max: 0 },
      transactionListener: message => messages.push(message)
    })

    const alwaysRollback = {
      unsafe: fixture.bunSql.unsafe.bind(fixture.bunSql),
      begin: async () => {
        throw new SQL.PostgresError("deadlock detected", {
          code: "ERR_POSTGRES_SERVER_ERROR",
          errno: "40P01"
        })
      }
    }

    await expect(transaction(alwaysRollback as any, IsolationLevel.Serializable, async () => "never")).rejects.toBeInstanceOf(SQL.PostgresError)
    expect(messages.some(message => message.includes("giving up"))).toBe(true)
  })

  test("fault injection propagates non-retryable rollback-shaped errors immediately", async () => {
    const nonRetryableRollback = {
      unsafe: fixture.bunSql.unsafe.bind(fixture.bunSql),
      begin: async () => {
        throw new SQL.PostgresError("unique violation", {
          code: "ERR_POSTGRES_SERVER_ERROR",
          errno: "23505"
        })
      }
    }

    await expect(
      transaction(nonRetryableRollback as any, IsolationLevel.Serializable, async () => {
        throw new Error("unreachable")
      })
    ).rejects.toBeInstanceOf(SQL.PostgresError)
  })

  test("fault injection retries when SQLSTATE is provided via PostgresError.code fallback", async () => {
    setConfig({
      transactionAttemptsMax: 2,
      transactionRetryDelay: { min: 0, max: 0 },
      transactionListener: false
    })

    let beginAttempts = 0
    const fallbackCodeRollback = {
      unsafe: fixture.bunSql.unsafe.bind(fixture.bunSql),
      begin: async (_options: string, callback: (client: any) => Promise<number>) => {
        beginAttempts++
        if (beginAttempts === 1) {
          throw new SQL.PostgresError("serialization failure", {
            code: "40001"
          })
        }
        return callback({ unsafe: fixture.bunSql.unsafe.bind(fixture.bunSql) })
      }
    }

    const result = await transaction(fallbackCodeRollback as any, IsolationLevel.Serializable, async () => "ok")
    expect(result).toBe("ok")
    expect(beginAttempts).toBe(2)
  })

  test("fault injection treats PostgresError without SQLSTATE as non-retryable", async () => {
    const noSqlStateRollback = {
      unsafe: fixture.bunSql.unsafe.bind(fixture.bunSql),
      begin: async () => {
        throw new SQL.PostgresError("generic server error", {
          code: "ERR_POSTGRES_SERVER_ERROR"
        })
      }
    }

    await expect(
      transaction(noSqlStateRollback as any, IsolationLevel.Serializable, async () => {
        throw new Error("unreachable")
      })
    ).rejects.toBeInstanceOf(SQL.PostgresError)
  })

  test("fault injection propagates non-SQL errors without retry", async () => {
    const genericFailureQueryable = {
      unsafe: fixture.bunSql.unsafe.bind(fixture.bunSql),
      begin: async () => {
        throw new Error("generic begin failure")
      }
    }

    await expect(
      transaction(genericFailureQueryable as any, IsolationLevel.Serializable, async () => {
        throw new Error("unreachable")
      })
    ).rejects.toThrow("generic begin failure")
  })

  test("nested transaction without savepoint falls back to direct callback execution", async () => {
    const brandedClient = {
      unsafe: fixture.bunSql.unsafe.bind(fixture.bunSql),
      __bmPostgres: {
        isolationLevel: IsolationLevel.ReadCommitted,
        transactionId: 777
      }
    }

    const result = await transaction(brandedClient as any, IsolationLevel.ReadCommitted, async transactionClient => {
      expect(transactionClient).toBe(brandedClient)
      const rows = await sql<never, Array<{ value: number }>>`SELECT 9 AS value`.run(transactionClient)
      return rows[0]!.value
    })

    expect(result).toBe(9)
  })

  test("malformed transaction brand is ignored and a new transaction is started", async () => {
    const malformedBrandQueryable = {
      unsafe: fixture.bunSql.unsafe.bind(fixture.bunSql),
      __bmPostgres: {
        isolationLevel: 123,
        transactionId: "oops"
      },
      begin: async (_options: string, callback: (client: any) => Promise<number>) => callback({ unsafe: fixture.bunSql.unsafe.bind(fixture.bunSql) })
    }

    const result = await transaction(malformedBrandQueryable as any, IsolationLevel.ReadCommitted, async transactionClient => {
      const rows = await sql<never, Array<{ value: number }>>`SELECT 11 AS value`.run(transactionClient)
      return rows[0]!.value
    })

    expect(result).toBe(11)
  })

  test("rejects unsupported transaction queryable shape", async () => {
    await expect(transaction({ unsafe: fixture.bunSql.unsafe.bind(fixture.bunSql) } as any, IsolationLevel.ReadCommitted, async () => 1)).rejects.toThrow(
      "Unsupported transaction queryable: expected Bun SQL client"
    )
  })

  test("resets transaction sequence when near Number.MAX_SAFE_INTEGER", async () => {
    __setTransactionSequenceForTests(Number.MAX_SAFE_INTEGER - 1)

    const firstTransactionId = await transaction(fixture.bunSql as any, IsolationLevel.ReadCommitted, async transactionClient => {
      return transactionClient.__bmPostgres?.transactionId
    })
    const secondTransactionId = await transaction(fixture.bunSql as any, IsolationLevel.ReadCommitted, async transactionClient => {
      return transactionClient.__bmPostgres?.transactionId
    })

    expect(firstTransactionId).toBe(0)
    expect(secondTransactionId).toBe(1)
  })
})
