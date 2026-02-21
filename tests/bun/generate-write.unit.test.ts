import { describe, expect, test } from "bun:test"

import { generate } from "../../src/bun/generate-write"

type WrittenFile = {
  path: string
  content: string
  options: { createPath: true }
}

function createTestDeps(params?: {
  existingFiles?: string[]
  ts?: string
  customTypeSourceFiles?: Record<string, string>
}) {
  const writtenFiles: WrittenFile[] = []
  const seenExistsChecks: string[] = []
  const existingFiles = new Set(params?.existingFiles ?? [])
  const logs: string[] = []
  const warnings: string[] = []
  const debugMessages: string[] = []
  const joined: string[] = []

  const ts = params?.ts ?? "// generated schema"
  const customTypeSourceFiles = params?.customTypeSourceFiles ?? {}

  const deps = {
    file: (path: string) => ({
      exists: async () => {
        seenExistsChecks.push(path)
        return existingFiles.has(path)
      }
    }),
    header: () => "// header\n",
    join: (...segments: string[]) => {
      const value = segments.join("/")
      joined.push(value)
      return value
    },
    tsForConfig: async (_config: any, debug: (s: string) => void) => {
      debug("debug hook reached")
      debugMessages.push("debug hook reached")
      return { ts, customTypeSourceFiles }
    },
    write: async (path: string, content: string, options: { createPath: true }) => {
      writtenFiles.push({ path, content, options })
      existingFiles.add(path)
    }
  }

  return { deps, writtenFiles, seenExistsChecks, logs, warnings, debugMessages, joined }
}

describe("bun generate-write", () => {
  test("writes schema, custom type files, and custom index when custom types are present", async () => {
    const customTypeSourceFiles = {
      email_address: "declare module '@brand-map/postgres/custom' { export type email_address = string }"
    }
    const { deps, writtenFiles, logs, warnings, debugMessages } = createTestDeps({
      ts: "// schema body",
      customTypeSourceFiles
    })

    await generate(
      {
        client: "bun",
        options: { url: "postgresql://localhost/postgres" },
        outDir: "out",
        progressListener: message => logs.push(message),
        warningListener: message => warnings.push(message),
        debugListener: message => debugMessages.push(message)
      },
      deps
    )

    expect(writtenFiles.map(w => w.path)).toEqual(["out/brand-map-postgres.schema.d.ts", "out/custom/email_address.d.ts", "out/custom/index.d.ts"])
    expect(writtenFiles[0]!.content).toBe("// schema body")
    expect(writtenFiles[1]!.content).toContain("email_address")
    expect(writtenFiles[2]!.content).toContain("declare module '@brand-map/postgres/custom' { }")
    expect(logs.some(m => m.includes("Writing generated schema: out/brand-map-postgres.schema.d.ts"))).toBe(true)
    expect(warnings.some(m => m.includes("Writing new custom type or domain placeholder file: out/custom/email_address.d.ts"))).toBe(true)
    expect(debugMessages.some(m => m.includes("debug hook reached"))).toBe(true)
  })

  test("does not overwrite existing custom type files, but still writes schema and custom index", async () => {
    const customTypeSourceFiles = {
      email_address: "declare module '@brand-map/postgres/custom' { export type email_address = string }"
    }
    const { deps, writtenFiles, seenExistsChecks, logs, warnings } = createTestDeps({
      existingFiles: ["out/custom/email_address.d.ts"],
      customTypeSourceFiles
    })

    await generate(
      {
        client: "bun",
        options: { url: "postgresql://localhost/postgres" },
        outDir: "out",
        progressListener: message => logs.push(message),
        warningListener: message => warnings.push(message),
        debugListener: false
      },
      deps
    )

    expect(seenExistsChecks).toContain("out/custom/email_address.d.ts")
    expect(writtenFiles.map(w => w.path)).toEqual(["out/brand-map-postgres.schema.d.ts", "out/custom/index.d.ts"])
    expect(logs.some(m => m.includes("Custom type or domain declaration file already exists: out/custom/email_address.d.ts"))).toBe(true)
    expect(warnings).toEqual([])
  })

  test("writes only schema when no custom types are generated", async () => {
    const { deps, writtenFiles, logs } = createTestDeps({
      customTypeSourceFiles: {}
    })

    await generate(
      {
        client: "bun",
        options: { url: "postgresql://localhost/postgres" },
        outDir: "out",
        progressListener: message => logs.push(message),
        warningListener: false,
        debugListener: false
      },
      deps
    )

    expect(writtenFiles.map(w => w.path)).toEqual(["out/brand-map-postgres.schema.d.ts"])
    expect(logs.some(m => m.includes("Writing generated schema: out/brand-map-postgres.schema.d.ts"))).toBe(true)
  })
})
