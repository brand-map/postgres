import { pascalCase } from "es-toolkit";

import type { CompleteConfig } from "./config";
import type { EnumData } from "./enums";

type TypeContext = "JsonSelectable" | "Selectable" | "Insertable" | "Updatable" | "Whereable";

let warnedAboutInt8AndNumeric = false;

const baseTsTypeForBasePgType = (pgType: string, enums: EnumData, context: TypeContext, config: CompleteConfig) => {
  const hasOwnProp = Object.prototype.hasOwnProperty;
  const warn = config.warningListener === true ? console.log : config.warningListener || (() => void 0);

  function warnAboutLargeNumbers() {
    if (warnedAboutInt8AndNumeric || config.customJsonParsingForLargeNumbers) {
      return;
    }

    warn(`Note: this database has bigint/int8 and/or numeric/decimal columns, for which JSON.parse may lose precision.`);

    warnedAboutInt8AndNumeric = true;
  }

  //  switch (pgType) {
  //   case "money":
  //     return context === "JsonSelectable" || context === "Selectable" ? "string" : "(number | string)";

  //   case "int8": {
  //     warnAboutLargeNumbers();

  //     if (context === "JsonSelectable") {
  //       return config.customJsonParsingForLargeNumbers ? "(number | db.Int8String)" : "number";
  //     }

  //     return context === "Selectable" ? "db.Int8String" : "(number | db.Int8String | bigint)";
  //   }

  //   case "numeric": {
  //     warnAboutLargeNumbers();

  //     if (context === "JsonSelectable") {
  //       return;
  //     }

  //     return context === "Selectable" ? "db.NumericString" : "(number | db.NumericString)";
  //   }

  //   case "bytea":
  //     return context === "JsonSelectable" ? "db.ByteArrayString" : context === "Selectable" ? "Buffer" : "(db.ByteArrayString | Buffer)";

  //   case "date":
  //     return context === "JsonSelectable" ? "string" : context === "Selectable" ? "Date" : "(string | Date)";

  //   case "timestamp":
  //     return context === "JsonSelectable" ? "string" : context === "Selectable" ? "Date" : "(string | Date)";

  //   case "timestamptz":
  //     return context === "JsonSelectable" ? "string" : context === "Selectable" ? "Date" : "(string | Date)";

  //   case "time":
  //     return "string";

  //   case "timetz":
  //     return "string";

  //   case "int4range":
  //   case "int8range":
  //   case "numrange":
  //     return "db.NumberRangeString";

  //   case "tsrange": // bounds format depends on pg DateStyle, hence only string-typed
  //   case "tstzrange": // ditto
  //   case "daterange": // ditto
  //     return "string";

  //   case "interval": // format depends on IntervalStyle, hence only string-typed
  //   case "bpchar":
  //   case "char":
  //   case "varchar":
  //   case "text":
  //   case "citext":
  //   case "uuid":
  //   case "inet":
  //   case "name":
  //     return "string";

  //   case "int2":
  //   case "int4":
  //   case "float4":
  //   case "float8":
  //   case "oid":
  //     return "number";

  //   case "bool":
  //     return "boolean";

  //   case "json":
  //   case "jsonb":
  //     return "db.JsonValue";

  //   default: {
  //     if (hasOwnProp.call(enums, pgType)) {
  //       return pgType;
  //     }
  //     return null;
  //   }
  // }

  switch (pgType) {
    case "money":
      return context === "JsonSelectable" || context === "Selectable" ? "string" : "(number | string)";

    case "int8": {
      warnAboutLargeNumbers();

      if (context === "JsonSelectable") {
        return config.customJsonParsingForLargeNumbers ? "(number | db.Int8String)" : "number";
      }

      return context === "Selectable" ? "db.Int8String" : "(number | db.Int8String | bigint)";
    }

    case "numeric": {
      warnAboutLargeNumbers();

      if (context === "JsonSelectable") {
        return;
      }

      return context === "Selectable" ? "db.NumericString" : "(number | db.NumericString)";
    }

    case "bytea":
      return context === "JsonSelectable" ? "db.ByteArrayString" : context === "Selectable" ? "Buffer" : "(db.ByteArrayString | Buffer)";

    case "date":
      return context === "JsonSelectable" ? "db.DateString" : context === "Selectable" ? "Date" : "(db.DateString | Date)";

    case "timestamp":
      return context === "JsonSelectable" ? "db.TimestampString" : context === "Selectable" ? "Date" : "(db.TimestampString | Date)";

    case "timestamptz":
      return context === "JsonSelectable" ? "db.TimestampTzString" : context === "Selectable" ? "Date" : "(db.TimestampTzString | Date)";

    case "time":
      return "db.TimeString";

    case "timetz":
      return "db.TimeTzString";

    case "int4range":
    case "int8range":
    case "numrange":
      return "db.NumberRangeString";

    case "tsrange": // bounds format depends on pg DateStyle, hence only string-typed
    case "tstzrange": // ditto
    case "daterange": // ditto
      return "db.DateRangeString";

    case "interval": // format depends on IntervalStyle, hence only string-typed
    case "bpchar":
    case "char":
    case "varchar":
    case "text":
    case "citext":
    case "uuid":
    case "inet":
    case "name":
      return "string";

    case "int2":
    case "int4":
    case "float4":
    case "float8":
    case "oid":
      return "number";

    case "bool":
      return "boolean";

    case "json":
    case "jsonb":
      return "db.JsonValue";

    default: {
      if (hasOwnProp.call(enums, pgType)) {
        return pascalCase(pgType);
      }
      return null;
    }
  }
};

export const tsTypeForPgType = (pgType: string, enums: EnumData, context: TypeContext, config: CompleteConfig) => {
  // basic and enum types (enum names can begin with an underscore even if not an array)
  const baseTsType = baseTsTypeForBasePgType(pgType, enums, context, config);
  if (baseTsType !== null) {
    return baseTsType;
  }

  // arrays of basic and enum types: pg prefixes these with underscore (_)
  // see https://www.postgresql.org/docs/current/sql-createtype.html#id-1.9.3.94.5.9
  if (pgType.charAt(0) === "_") {
    const arrayTsType = baseTsTypeForBasePgType(pgType.slice(1), enums, context, config);
    if (arrayTsType !== null) {
      return `${arrayTsType}[]`;
    }
  }

  return "any";
};
