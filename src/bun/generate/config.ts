import type { SQL } from "bun"

import type { GeneratorCommonConfig } from "../../types"

type GeneratorClientConfig = {
  client: "bun"
  options: SQL.PostgresOrMySQLOptions
}

export type BaseConfig = GeneratorClientConfig

export type Config = BaseConfig & Partial<GeneratorCommonConfig>
export type CompleteConfig = BaseConfig & GeneratorCommonConfig

const defaultClientConfig: BaseConfig = {
  client: "bun",
  options: { url: "postgresql://postgres:postgres@localhost:5432/postgres" }
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

export const finaliseConfig = (config: Config) => ({ ...defaultConfig, ...defaultClientConfig, ...config }) as CompleteConfig
