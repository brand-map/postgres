import type { BunSqlQueryable } from "../../src/bun/db/exports"
import type { BunTransactionQueryable, BunTransactionClient } from "../../src/bun/db/transaction"

import { describe, expect, test } from "bun:test"

import { sql } from "../../src/bun/db/exports"
import { IsolationLevel, transaction } from "../../src/bun/db/transaction"

type UnsafeCall = {
  text: string
  values: any[] | undefined
}

function createBunQueryable(rows: any[]) {
  const calls: UnsafeCall[] = []
  const queryable = {
    unsafe: async (text: string, values?: any[]) => {
      calls.push({ text, values })
      return rows
    }
  } satisfies BunSqlQueryable

  return { queryable, calls }
}

describe("bun sql compatibility", () => {
  test("sql.run executes through Bun SQL unsafe and preserves row keys", async () => {
    const { queryable, calls } = createBunQueryable([{ snake_case_value: 7 }])

    const rows = await sql<never, Array<{ snake_case_value: number }>>`SELECT 7 AS snake_case_value`.run(queryable)

    expect(rows).toEqual([{ snake_case_value: 7 }])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.text).toContain("SELECT 7 AS snake_case_value")
    expect(calls[0]!.values).toEqual([])
  })

  test("transaction uses Bun SQL begin and passes branded transactionClient client", async () => {
    const queries: string[] = []
    let transactionClientRef: { __bmPostgres?: unknown } | undefined

    const bunSql = {
      unsafe: async () => [],
      begin: async <T>(options: string, callback: (transactionClient: BunTransactionClient<IsolationLevel>) => Promise<T>): Promise<T> => {
        expect(options).toBe("ISOLATION LEVEL READ COMMITTED, READ ONLY")

        const transactionClient = {
          unsafe: async (text: string, _values?: any[]) => {
            queries.push(text)
            return []
          }
        }

        transactionClientRef = transactionClient
        return callback(transactionClient)
      }
    } satisfies BunTransactionQueryable

    const result = await transaction(bunSql, IsolationLevel.ReadCommittedReadOnly, async transactionClient => {
      expect(transactionClient.__bmPostgres?.isolationLevel).toBe(IsolationLevel.ReadCommittedReadOnly)
      await sql`SELECT 1`.run(transactionClient)
      return "done"
    })

    expect(result).toBe("done")
    expect(queries[0]).toContain("SELECT 1")
    expect(transactionClientRef?.__bmPostgres).toBeUndefined()
  })

  test("transaction retries serialization failures when using Bun SQL", async () => {
    let attempts = 0

    const bunSql = {
      unsafe: async () => [],
      begin: async <T>(_options: string, callback: (transactionClient: BunTransactionClient<IsolationLevel>) => Promise<T>): Promise<T> => {
        attempts += 1

        if (attempts === 1) {
          throw { code: "40001" }
        }

        return callback({
          unsafe: async () => []
        })
      }
    } satisfies BunTransactionQueryable

    const value = await transaction(bunSql, IsolationLevel.Serializable, async () => "ok")

    expect(value).toBe("ok")
    expect(attempts).toBe(2)
  })

  test("nested transaction calls share the same Bun SQL transaction client", async () => {
    let beginCalls = 0

    const bunSql = {
      unsafe: async () => [],
      begin: async <T>(_options: string, callback: (transactionClient: BunTransactionClient<IsolationLevel>) => Promise<T>): Promise<T> => {
        beginCalls += 1
        return callback({
          unsafe: async () => []
        })
      }
    } satisfies BunTransactionQueryable

    const result = await transaction(bunSql, IsolationLevel.Serializable, async outerTransactionClient =>
      transaction(outerTransactionClient, IsolationLevel.ReadCommitted, async innerTransactionClient => {
        expect(innerTransactionClient).toBe(outerTransactionClient)
        return 42
      })
    )

    expect(result).toBe(42)
    expect(beginCalls).toBe(1)
  })
})
