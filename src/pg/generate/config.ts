import type * as pg from "pg"

import type { GeneratorCommonConfig } from "../../types"

export type DbClient = "pg"
export type DbConfig = pg.ClientConfig | string | URL | Record<string, unknown>

type GeneratorClientConfig = {
  client: "pg"
  config: DbConfig
}

export type BaseConfig = GeneratorClientConfig

export type Config = BaseConfig & Partial<GeneratorCommonConfig>
export type CompleteConfig = BaseConfig & GeneratorCommonConfig

const defaultClientConfig: Extract<BaseConfig, { client: "pg" }> = {
  client: "pg",
  config: "postgresql://postgres:postgres@localhost:5432/postgres"
}

const defaultConfig: GeneratorCommonConfig = {
  outDir: ".",
  outExt: ".d.ts",
  schemas: { public: { include: "*", exclude: [] } },
  debugListener: false,
  progressListener: false,
  warningListener: true,
  customTypesTransform: "my_type",
  columnOptions: {},
  schemaJSDoc: true,
  unprefixedSchema: "public",
  customJsonParsingForLargeNumbers: false
}

export const finaliseConfig = (config: Config) => {
  const finalConfig = { ...defaultConfig, ...defaultClientConfig, ...config }
  return finalConfig as CompleteConfig
}
