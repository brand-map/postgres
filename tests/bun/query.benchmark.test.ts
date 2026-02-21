import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"

import { count, insert, selectOne } from "../../src/bun/db-shortcuts"
import { IsolationLevel, transaction } from "../../src/bun/db-transaction"
import { sql } from "../../src/bun/db-core"
import { createBunPgliteFixture, type BunPgliteFixture } from "../shared/bun-pglite.helpers"

type BenchmarkCase = {
  name: string
  iterations: number
  warmup: number
  run: (iteration: number) => Promise<void>
}

type BenchmarkResult = {
  name: string
  iterations: number
  totalMs: number
  avgMs: number
  minMs: number
  maxMs: number
  p50Ms: number
  p95Ms: number
  opsPerSec: number
}

let fixture: BunPgliteFixture

beforeAll(async () => {
  fixture = await createBunPgliteFixture("bm_bun_bench")
})

beforeEach(async () => {
  await fixture.reset()
})

afterAll(async () => {
  await fixture.close()
})

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[index]!
}

async function runBenchmarkCase(benchCase: BenchmarkCase): Promise<BenchmarkResult> {
  for (let i = 0; i < benchCase.warmup; i++) {
    await benchCase.run(i)
  }

  const durationsMs: number[] = []
  const start = performance.now()

  for (let i = 0; i < benchCase.iterations; i++) {
    const opStart = performance.now()
    await benchCase.run(i)
    durationsMs.push(performance.now() - opStart)
  }

  const totalMs = performance.now() - start
  const sorted = durationsMs.slice().sort((a, b) => a - b)
  const avgMs = totalMs / benchCase.iterations
  const opsPerSec = benchCase.iterations / (totalMs / 1000)

  return {
    name: benchCase.name,
    iterations: benchCase.iterations,
    totalMs,
    avgMs,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    opsPerSec
  }
}

function logBenchmarkResult(result: BenchmarkResult) {
  console.log(
    `[benchmark] ${result.name}: ${result.opsPerSec.toFixed(2)} ops/s | avg ${result.avgMs.toFixed(3)}ms | p50 ${result.p50Ms.toFixed(3)}ms | p95 ${result.p95Ms.toFixed(3)}ms | min ${result.minMs.toFixed(3)}ms | max ${result.maxMs.toFixed(3)}ms | total ${result.totalMs.toFixed(2)}ms`
  )
}

const benchmarkTest = process.env.BRAND_MAP_POSTGRES_RUN_BENCHMARKS === "1" ? test : test.skip
const benchmarkIterations = Number(process.env.BRAND_MAP_POSTGRES_BENCH_ITERATIONS ?? "300")
const benchmarkWarmup = Number(process.env.BRAND_MAP_POSTGRES_BENCH_WARMUP ?? "40")

describe("bun query benchmarks (pglite)", () => {
  benchmarkTest(
    "measures core query paths",
    async () => {
      let uniqueSeq = 0
      const usersTable = fixture.usersTable as any
      const postsTable = fixture.postsTable as any

      const benchmarkCases: BenchmarkCase[] = [
        {
          name: "raw unsafe SELECT 1",
          iterations: benchmarkIterations,
          warmup: benchmarkWarmup,
          run: async () => {
            await fixture.bunSql.unsafe(`SELECT 1 AS value`)
          }
        },
        {
          name: "sql fragment run SELECT 1",
          iterations: benchmarkIterations,
          warmup: benchmarkWarmup,
          run: async () => {
            await sql`SELECT 1 AS value`.run(fixture.bunSql)
          }
        },
        {
          name: "shortcut selectOne by PK",
          iterations: benchmarkIterations,
          warmup: benchmarkWarmup,
          run: async () => {
            await selectOne(usersTable, { id: 1 } as any).run(fixture.bunSql)
          }
        },
        {
          name: "transaction read count",
          iterations: benchmarkIterations,
          warmup: benchmarkWarmup,
          run: async () => {
            await transaction(fixture.bunSql as any, IsolationLevel.ReadCommitted, async transactionClient => {
              await count(postsTable, { user_id: 1 } as any).run(transactionClient)
            })
          }
        },
        {
          name: "insert one post row",
          iterations: benchmarkIterations,
          warmup: benchmarkWarmup,
          run: async () => {
            uniqueSeq += 1
            await insert(postsTable, { user_id: 1, title: `bench-title-${uniqueSeq}` } as any).run(fixture.bunSql)
          }
        }
      ]

      const results: BenchmarkResult[] = []
      for (const benchCase of benchmarkCases) {
        const result = await runBenchmarkCase(benchCase)
        results.push(result)
        logBenchmarkResult(result)
      }

      expect(results).toHaveLength(benchmarkCases.length)
      for (const result of results) {
        expect(Number.isFinite(result.opsPerSec)).toBe(true)
        expect(result.opsPerSec).toBeGreaterThan(0)
        expect(result.avgMs).toBeGreaterThan(0)
      }
    },
    180_000
  )
})
