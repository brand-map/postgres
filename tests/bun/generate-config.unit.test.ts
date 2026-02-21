import { describe, expect, test } from "bun:test"

import { finaliseConfig } from "../../src/bun/generate-config"

describe("bun generate-config", () => {
  test("finaliseConfig applies default values", () => {
    const config = finaliseConfig({ client: "bun", options: { url: "postgresql://localhost/postgres" } })

    expect(config.client).toBe("bun")
    expect(config.outDir).toBe(".")
    expect(config.outExt).toBe(".d.ts")
    expect(config.schemas).toEqual({ public: { include: "*", exclude: [] } })
    expect(config.customTypesTransform).toBe("my_type")
    expect(config.unprefixedSchema).toBe("public")
    expect(config.customJsonParsingForLargeNumbers).toBe(false)
  })

  test("finaliseConfig preserves explicit overrides", () => {
    const warningListener = () => {}
    const progressListener = () => {}
    const debugListener = () => {}

    const config = finaliseConfig({
      client: "bun",
      options: { url: "postgresql://localhost/custom", max: 3 },
      outDir: "/tmp/out",
      outExt: ".ts",
      schemas: {
        app: { include: ["users"], exclude: ["audit_log"] }
      },
      warningListener,
      progressListener,
      debugListener,
      customTypesTransform: "snake_case",
      columnOptions: { users: { email: { customType: "email_address" } } as any },
      schemaJSDoc: false,
      unprefixedSchema: null,
      customJsonParsingForLargeNumbers: true
    })

    expect(config.options).toEqual({ url: "postgresql://localhost/custom", max: 3 })
    expect(config.outDir).toBe("/tmp/out")
    expect(config.outExt).toBe(".ts")
    expect(config.schemas).toEqual({ app: { include: ["users"], exclude: ["audit_log"] } })
    expect(config.warningListener).toBe(warningListener)
    expect(config.progressListener).toBe(progressListener)
    expect(config.debugListener).toBe(debugListener)
    expect(config.customTypesTransform).toBe("snake_case")
    expect(config.schemaJSDoc).toBe(false)
    expect(config.unprefixedSchema).toBeNull()
    expect(config.customJsonParsingForLargeNumbers).toBe(true)
  })
})
