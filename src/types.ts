export type GeneratorListener = boolean | ((s: string) => void)

export type CustomTypesTransform = "PgMy_type" | "my_type" | "PgMyType" | ((s: string) => string)

export interface SchemaRules {
  [schema: string]: {
    include: "*" | string[]
    exclude: "*" | string[]
  }
}

export interface ColumnOptions {
  [table: string]: {
    [column: string]: {
      insert?: "auto" | "excluded" | "optional"
      update?: "auto" | "excluded"
    }
  }
}

export interface GeneratorCommonConfig {
  outDir: string
  outExt: string
  schemas: SchemaRules
  debugListener: GeneratorListener
  progressListener: GeneratorListener
  warningListener: GeneratorListener
  customTypesTransform: CustomTypesTransform
  columnOptions: ColumnOptions
  schemaJSDoc: boolean
  unprefixedSchema: string | null
  customJsonParsingForLargeNumbers: boolean
}

export interface CustomTypes {
  [name: string]: string
}

export interface SqlQuery {
  text: string
  values: any[]
  name?: string
}

export interface QueryResult<Row = any> {
  rows: Row[]
}

/**
 * Date-like values are represented as plain strings.
 */
export type DateString = string
export type TimeString = string
export type TzSuffix = string
export type TimeTzString = string
export type TimestampString = string
export type TimestampTzString = string
