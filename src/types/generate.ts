export type GeneratorListener = boolean | ((s: string) => void);

export type CustomTypesTransform = "PgMy_type" | "my_type" | "PgMyType" | ((s: string) => string);

export interface SchemaRules {
  [schema: string]: {
    include: "*" | string[];
    exclude: "*" | string[];
  };
}

export interface ColumnOptions {
  [table: string]: {
    [column: string]: {
      insert?: "auto" | "excluded" | "optional";
      update?: "auto" | "excluded";
    };
  };
}

export interface GeneratorCommonConfig {
  outDir: string;
  outExt: string;
  schemas: SchemaRules;
  debugListener: GeneratorListener;
  progressListener: GeneratorListener;
  warningListener: GeneratorListener;
  customTypesTransform: CustomTypesTransform;
  columnOptions: ColumnOptions;
  schemaJSDoc: boolean;
  unprefixedSchema: string | null;
  customJsonParsingForLargeNumbers: boolean;
}

export interface CustomTypes {
  [name: string]: string;
}
