import assert from "node:assert/strict";

import type {
  JsonSelectableForTable,
  WhereableForTable,
  InsertableForTable,
  UpdatableForTable,
  ColumnForTable,
  UniqueIndexForTable,
  SqlForTable,
  Insertable,
  Updatable,
  Whereable,
  Table,
  Column,
} from "@brand-map/postgres/schema";
import { toCamelCaseKeys } from "es-toolkit";

import { type AllType, all, type Sql, SqlFragment, sql, cols, vals, raw, param, Default } from "./core";
import { completeKeysWithDefaultValue, completeKeysWithDefaultValueObject, mapWithSeparator, type NoInfer } from "./utils";

export type JsonOnlyColsForTable<T extends Table, C extends any[] /* `ColumnForTable<T>[]` gives errors here for reasons I haven't got to the bottom of */> = Pick<
  JsonSelectableForTable<T>,
  Exclude<C[number], "*">
>;

export interface SqlFragmentMap {
  [k: string]: SqlFragment<any>;
}

export interface SqlFragmentOrColumnMap<T extends Table> {
  [k: string]: SqlFragment<any> | ColumnForTable<T>;
}

export type RunResultForSqlFragment<T extends SqlFragment<any, any>> =
  T extends SqlFragment<infer RunResult, any> ? (undefined extends RunResult ? NonNullable<RunResult> | null : RunResult) : never;

export type LateralResult<L extends SqlFragmentMap> = {
  [K in keyof L]: RunResultForSqlFragment<L[K]>;
};

export type ExtrasResult<T extends Table, E extends SqlFragmentOrColumnMap<T>> = {
  [K in keyof E]: E[K] extends SqlFragment<any> ? RunResultForSqlFragment<E[K]> : E[K] extends keyof JsonSelectableForTable<T> ? JsonSelectableForTable<T>[E[K]] : never;
};

export type ExtrasOption<T extends Table> = SqlFragmentOrColumnMap<T> | undefined;
export type ColumnsOption<T extends Table> = readonly ColumnForTable<T>[] | undefined;

type LimitedLateralOption = SqlFragmentMap | undefined;
type FullLateralOption = LimitedLateralOption | SqlFragment<any>;
export type LateralOption<C extends ColumnsOption<Table>, E extends ExtrasOption<Table>> = undefined extends C
  ? undefined extends E
    ? FullLateralOption
    : LimitedLateralOption
  : LimitedLateralOption;

export interface ReturningOptionsForTable<T extends Table, C extends ColumnsOption<T>, E extends ExtrasOption<T>> {
  returning?: C;
  extras?: E;
}

type ReturningTypeForTable<T extends Table, C extends ColumnsOption<T>, E extends ExtrasOption<T>> = (undefined extends C
  ? JsonSelectableForTable<T>
  : C extends ColumnForTable<T>[]
    ? JsonOnlyColsForTable<T, C>
    : never) &
  (undefined extends E ? {} : E extends SqlFragmentOrColumnMap<T> ? ExtrasResult<T, E> : never);

function SqlForColumnsOfTable(columns: readonly Column[] | undefined, table: Table) {
  return columns === undefined ? sql`to_jsonb(${table}.*)` : sql`jsonb_build_object(${mapWithSeparator(columns, sql`, `, (c) => sql`${param(c)}::text, ${c}`)})`;
}

function SqlForExtras<T extends Table>(extras: ExtrasOption<T>) {
  return extras === undefined ? [] : sql` || jsonb_build_object(${mapWithSeparator(Object.keys(extras), sql`, `, (k) => sql`${param(k)}::text, ${extras[k]!}`)})`;
}

/* === insert === */

interface InsertSignatures {
  <T extends Table, C extends ColumnsOption<T>, E extends ExtrasOption<T>>(
    table: T,
    values: InsertableForTable<T>,
    options?: ReturningOptionsForTable<T, C, E>,
  ): SqlFragment<ReturningTypeForTable<T, C, E>>;

  <T extends Table, C extends ColumnsOption<T>, E extends ExtrasOption<T>>(
    table: T,
    values: InsertableForTable<T>[],
    options?: ReturningOptionsForTable<T, C, E>,
  ): SqlFragment<ReturningTypeForTable<T, C, E>[]>;
}

/**
 * Generate an `INSERT` query `SqlFragment`.
 * @param table The table into which to insert
 * @param values The `Insertable` values (or array thereof) to be inserted
 */
export const insert: InsertSignatures = function (
  table: Table,
  values: Insertable | Insertable[],
  options?: ReturningOptionsForTable<Table, ColumnsOption<Table>, ExtrasOption<Table>>,
): SqlFragment<any> {
  let query;

  if (Array.isArray(values) && values.length === 0) {
    query = sql`INSERT INTO ${table} SELECT null WHERE false`;
    query.noop = true;
    query.noopResult = [];
  } else {
    const completedValues = Array.isArray(values) ? completeKeysWithDefaultValue(values, Default) : completeKeysWithDefaultValueObject(values, Default);
    const colsSql = cols(Array.isArray(completedValues) ? completedValues[0]! : completedValues);
    const valuesSql = Array.isArray(completedValues) ? mapWithSeparator(completedValues as Insertable[], sql`, `, (v) => sql`(${vals(v)})`) : sql`(${vals(completedValues)})`;
    const returningSql = SqlForColumnsOfTable(options?.returning, table);
    const extrasSql = SqlForExtras(options?.extras);

    query = sql`INSERT INTO ${table} (${colsSql}) VALUES ${valuesSql} RETURNING ${returningSql}${extrasSql} AS result`;
  }

  query.runResultTransform = toCamelCaseKeys(Array.isArray(values) ? (queryResult) => queryResult.rows.map((r) => r.result) : (queryResult) => queryResult.rows[0].result);

  return query;
};

/* === upsert === */

/**
 * Wraps a unique index of the target table for use as the arbiter constraint
 * of an `upsert` shortcut query.
 */
export class Constraint<T extends Table> {
  constructor(public value: UniqueIndexForTable<T>) {}
}
/**
 * Returns a `Constraint` instance, wrapping a unique index of the target table
 * for use as the arbiter constraint of an `upsert` shortcut query.
 */
export function constraint<T extends Table>(x: UniqueIndexForTable<T>) {
  return new Constraint<T>(x);
}

export interface UpsertAction {
  $action: "INSERT" | "UPDATE";
}

type UpsertReportAction = "suppress";
type UpsertReturnableForTable<T extends Table, C extends ColumnsOption<T>, E extends ExtrasOption<T>, RA extends UpsertReportAction | undefined> = ReturningTypeForTable<T, C, E> &
  (undefined extends RA ? UpsertAction : {});

export type UpsertConflictTargetForTable<T extends Table> = Constraint<T> | ColumnForTable<T> | ColumnForTable<T>[];
type UpdateColumns<T extends Table> = ColumnForTable<T> | ColumnForTable<T>[];

interface UpsertOptions<
  T extends Table,
  C extends ColumnsOption<T>,
  E extends ExtrasOption<T>,
  UC extends UpdateColumns<T> | undefined,
  RA extends UpsertReportAction | undefined,
> extends ReturningOptionsForTable<T, C, E> {
  updateValues?: UpdatableForTable<T>;
  updateColumns?: UC;
  noNullUpdateColumns?: ColumnForTable<T> | ColumnForTable<T>[] | typeof all;
  reportAction?: RA;
}

interface UpsertSignatures {
  <T extends Table, C extends ColumnsOption<T>, E extends ExtrasOption<T>, UC extends UpdateColumns<T> | undefined, RA extends UpsertReportAction | undefined>(
    table: T,
    values: InsertableForTable<T>,
    conflictTarget: UpsertConflictTargetForTable<T>,
    options?: UpsertOptions<T, C, E, UC, RA>,
  ): SqlFragment<UpsertReturnableForTable<T, C, E, RA> | (UC extends never[] ? undefined : never)>;

  <T extends Table, C extends ColumnsOption<T>, E extends ExtrasOption<T>, UC extends UpdateColumns<T> | undefined, RA extends UpsertReportAction | undefined>(
    table: T,
    values: InsertableForTable<T>[],
    conflictTarget: UpsertConflictTargetForTable<T>,
    options?: UpsertOptions<T, C, E, UC, RA>,
  ): SqlFragment<UpsertReturnableForTable<T, C, E, RA>[]>;
}

export const doNothing = [];

/**
 * Generate an 'upsert' (`INSERT ... ON CONFLICT ...`) query `SqlFragment`.
 * @param table The table to update or insert into
 * @param values An `Insertable` of values (or an array thereof) to be inserted
 * or updated
 * @param conflictTarget A `UNIQUE`-indexed column (or array thereof) or a
 * `UNIQUE` index (wrapped in `db.constraint(...)`) that determines whether we
 * get an `UPDATE` (when there's a matching existing value) or an `INSERT`
 * (when there isn't)
 * @param options Optionally, an object with any of the keys `updateColumns`,
 * `noNullUpdateColumns` and `updateValues` (see documentation).
 */
export const upsert: UpsertSignatures = function (
  table: Table,
  values: Insertable | Insertable[],
  conflictTarget: Column | Column[] | Constraint<Table>,
  options?: UpsertOptions<Table, ColumnsOption<Table>, ExtrasOption<Table>, UpdateColumns<Table>, UpsertReportAction>,
): SqlFragment<any> {
  if (Array.isArray(values) && values.length === 0) {
    // punt a no-op to plain insert
    return insert(table, values);
  }
  if (typeof conflictTarget === "string") {
    conflictTarget = [conflictTarget]; // now either Column[] or Constraint
  }

  let noNullUpdateColumns = options?.noNullUpdateColumns ?? [];

  if (noNullUpdateColumns !== all && !Array.isArray(noNullUpdateColumns)) {
    noNullUpdateColumns = [noNullUpdateColumns];
  }

  let specifiedUpdateColumns = options?.updateColumns;
  if (specifiedUpdateColumns && !Array.isArray(specifiedUpdateColumns)) {
    specifiedUpdateColumns = [specifiedUpdateColumns];
  }

  const completedValues = Array.isArray(values) ? completeKeysWithDefaultValue(values, Default) : [values];
  const firstRow = completedValues[0]!;
  const insertColsSql = cols(firstRow);
  const insertValuesSql = mapWithSeparator(completedValues, sql`, `, (v) => sql`(${vals(v)})`);
  const colNames = Object.keys(firstRow) as Column[];
  const updateValues = options?.updateValues ?? {};

  // deduplicate the keys here
  const updateColumns = Array.from(new Set([...((specifiedUpdateColumns as string[]) ?? colNames), ...Object.keys(updateValues)]));

  const conflictTargetSql = Array.isArray(conflictTarget) ? sql`(${mapWithSeparator(conflictTarget, sql`, `, (c) => c)})` : sql<string>`ON CONSTRAINT ${conflictTarget.value}`;
  const updateColsSql = mapWithSeparator(updateColumns, sql`, `, (c) => c);

  const updateValuesSql = mapWithSeparator(updateColumns, sql`, `, (c) => {
    if (updateValues[c] !== undefined) {
      updateValues[c];
    }

    if (noNullUpdateColumns === all || noNullUpdateColumns.includes(c)) {
      return sql`CASE WHEN EXCLUDED.${c} IS NULL THEN ${table}.${c} ELSE EXCLUDED.${c} END`;
    }

    return sql`EXCLUDED.${c}`;
  });

  const returningSql = SqlForColumnsOfTable(options?.returning, table);
  const extrasSql = SqlForExtras(options?.extras);
  const suppressReport = options?.reportAction === "suppress";

  // the added-on $action = 'INSERT' | 'UPDATE' key takes after Sql Server's approach to MERGE
  // (and on the use of xmax for this purpose, see: https://stackoverflow.com/questions/39058213/postgresql-upsert-differentiate-inserted-and-updated-rows-using-system-columns-x)

  const insertPart = sql`INSERT INTO ${table} (${insertColsSql}) VALUES ${insertValuesSql}`;
  const conflictPart = sql`ON CONFLICT ${conflictTargetSql} DO`;
  const conflictActionPart = updateColsSql.length > 0 ? sql`UPDATE SET (${updateColsSql}) = ROW(${updateValuesSql})` : sql`NOTHING`;
  const reportPart = sql` || jsonb_build_object('$action', CASE xmax WHEN 0 THEN 'INSERT' ELSE 'UPDATE' END)`;
  const returningPart = sql`RETURNING ${returningSql}${extrasSql}${suppressReport ? [] : reportPart} AS result`;
  const query = sql`${insertPart} ${conflictPart} ${conflictActionPart} ${returningPart}`;

  query.runResultTransform = toCamelCaseKeys(Array.isArray(values) ? (queryResult) => queryResult.rows.map((r) => r.result) : (queryResult) => queryResult.rows[0]?.result);

  return query;
};

/* === update === */

type UpdateSignatures = <T extends Table, C extends ColumnsOption<T>, E extends ExtrasOption<T>>(
  table: T,
  values: UpdatableForTable<T>,
  where: WhereableForTable<T> | SqlFragment<any>,
  options?: ReturningOptionsForTable<T, C, E>,
) => SqlFragment<ReturningTypeForTable<T, C, E>[]>;

/**
 * Generate an `UPDATE` query `SqlFragment`.
 * @param table The table to update
 * @param values An `Updatable` of the new values with which to update the table
 * @param where A `Whereable` (or `SqlFragment`) defining which rows to update
 */
export const update: UpdateSignatures = function (
  table: Table,
  values: Updatable,
  where: Whereable | SqlFragment<any>,
  options?: ReturningOptionsForTable<Table, ColumnsOption<Table>, ExtrasOption<Table>>,
): SqlFragment {
  // note: the ROW() constructor below is required in Postgres 10+ if we're updating a single column
  // more info: https://www.postgresql-archive.org/Possible-regression-in-UPDATE-SET-lt-column-list-gt-lt-row-expression-gt-with-just-one-single-column0-td5989074.html

  const returningSql = SqlForColumnsOfTable(options?.returning, table),
    extrasSql = SqlForExtras(options?.extras),
    query = sql`UPDATE ${table} SET (${cols(values)}) = ROW(${vals(values)}) WHERE ${where} RETURNING ${returningSql}${extrasSql} AS result`;

  query.runResultTransform = (queryResult) => toCamelCaseKeys(queryResult.rows.map((r) => r.result));
  return query;
};

/* === delete === */

export type DeleteSignatures = <T extends Table, C extends ColumnsOption<T>, E extends ExtrasOption<T>>(
  table: T,
  where: WhereableForTable<T> | SqlFragment<any>,
  options?: ReturningOptionsForTable<T, C, E>,
) => SqlFragment<ReturningTypeForTable<T, C, E>[]>;

/**
 * Generate an `DELETE` query `SqlFragment` (plain 'delete' is a reserved word)
 * @param table The table to delete from
 * @param where A `Whereable` (or `SqlFragment`) defining which rows to delete
 */
export const deletes: DeleteSignatures = function (
  table: Table,
  where: Whereable | SqlFragment<any>,
  options?: ReturningOptionsForTable<Table, ColumnsOption<Table>, ExtrasOption<Table>>,
): SqlFragment {
  const returningSql = SqlForColumnsOfTable(options?.returning, table),
    extrasSql = SqlForExtras(options?.extras),
    query = sql`DELETE FROM ${table} WHERE ${where} RETURNING ${returningSql}${extrasSql} AS result`;

  query.runResultTransform = (queryResult) => toCamelCaseKeys(queryResult.rows.map((r) => r.result));
  return query;
};

/* === truncate === */

type TruncateIdentityOpts = "CONTINUE IDENTITY" | "RESTART IDENTITY";
type TruncateForeignKeyOpts = "RESTRICT" | "CASCADE";

interface TruncateSignatures {
  (table: Table | Table[]): SqlFragment<undefined>;
  (table: Table | Table[], optId: TruncateIdentityOpts): SqlFragment<undefined>;
  (table: Table | Table[], optFK: TruncateForeignKeyOpts): SqlFragment<undefined>;
  (table: Table | Table[], optId: TruncateIdentityOpts, optFK: TruncateForeignKeyOpts): SqlFragment<undefined>;
}

/**
 * Generate a `TRUNCATE` query `SqlFragment`.
 * @param table The table (or array thereof) to truncate
 * @param opts Options: 'CONTINUE IDENTITY'/'RESTART IDENTITY' and/or
 * 'RESTRICT'/'CASCADE'
 */
export const truncate: TruncateSignatures = function (table: Table | Table[], ...opts: string[]): SqlFragment<undefined> {
  if (!Array.isArray(table)) {
    table = [table];
  }
  const tables = mapWithSeparator(table, sql`, `, (t) => t),
    query = sql<Sql, undefined>`TRUNCATE ${tables}${raw((opts.length ? " " : "") + opts.join(" "))}`;

  return query;
};

/* === select === */

export interface OrderSpecForTable<T extends Table> {
  by: SqlForTable<T>;
  direction: "ASC" | "DESC";
  nulls?: "FIRST" | "LAST";
}

type Unprefixed<S extends string> = S extends `${infer _}.${infer Rest}` ? Rest : S;

export interface SelectLockingOptions<A extends string> {
  for: "UPDATE" | "NO KEY UPDATE" | "SHARE" | "KEY SHARE";
  of?: Unprefixed<Table> | A | (Unprefixed<Table> | A)[];
  wait?: "NOWAIT" | "SKIP LOCKED";
}

export interface SelectOptionsForTable<T extends Table, C extends ColumnsOption<T>, L extends LateralOption<C, E>, E extends ExtrasOption<T>, A extends string> {
  distinct?: boolean | ColumnForTable<T> | ColumnForTable<T>[] | SqlFragment<any>;
  order?: OrderSpecForTable<T> | OrderSpecForTable<T>[] | undefined;
  limit?: number;
  offset?: number;
  withTies?: boolean;
  columns?: C;
  extras?: E;
  groupBy?: ColumnForTable<T> | ColumnForTable<T>[] | SqlFragment<any>;
  having?: WhereableForTable<T> | SqlFragment<any>;
  lateral?: L;
  alias?: A;
  lock?: SelectLockingOptions<NoInfer<A>> | SelectLockingOptions<NoInfer<A>>[];
}

type SelectReturnTypeForTable<T extends Table, C extends ColumnsOption<T>, L extends LateralOption<C, E>, E extends ExtrasOption<T>> = undefined extends L
  ? ReturningTypeForTable<T, C, E>
  : L extends SqlFragmentMap
    ? ReturningTypeForTable<T, C, E> & LateralResult<L>
    : L extends SqlFragment<any>
      ? RunResultForSqlFragment<L>
      : never;

export enum SelectResultMode {
  Many,
  One,
  ExactlyOne,
  Numeric,
}

export type FullSelectReturnTypeForTable<T extends Table, C extends ColumnsOption<T>, L extends LateralOption<C, E>, E extends ExtrasOption<T>, M extends SelectResultMode> = {
  [SelectResultMode.Many]: SelectReturnTypeForTable<T, C, L, E>[];
  [SelectResultMode.ExactlyOne]: SelectReturnTypeForTable<T, C, L, E>;
  [SelectResultMode.One]: SelectReturnTypeForTable<T, C, L, E> | undefined;
  [SelectResultMode.Numeric]: number;
}[M];

export type SelectSignatures = <
  T extends Table,
  C extends ColumnsOption<T>,
  L extends LateralOption<C, E>,
  E extends ExtrasOption<T>,
  A extends string = never,
  M extends SelectResultMode = SelectResultMode.Many,
>(
  table: T,
  where: WhereableForTable<T> | SqlFragment<any> | AllType,
  options?: SelectOptionsForTable<T, C, L, E, A>,
  mode?: M,
  aggregate?: string,
) => SqlFragment<FullSelectReturnTypeForTable<T, C, L, E, M>>;

export class NotExactlyOneError extends Error {
  // see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error
  query: SqlFragment;
  constructor(query: SqlFragment, ...params: any[]) {
    super(...params);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NotExactlyOneError); // V8 only
    }
    this.name = "NotExactlyOneError";
    this.query = query; // custom property
  }
}

/**
 * Generate a `SELECT` query `SqlFragment`. This can be nested with other
 * `select`/`selectOne`/`count` queries using the `lateral` option.
 * @param table The table to select from
 * @param where A `Whereable` or `SqlFragment` defining the rows to be selected,
 * or `all`
 * @param options Options object. Keys (all optional) are:
 * * `columns` — an array of column names: only these columns will be returned
 * * `order` – an array of `OrderSpec` objects, such as
 * `{ by: 'column', direction: 'ASC' }`
 * * `limit` and `offset` – numbers: apply this limit and offset to the query
 * * `lateral` — either an object mapping keys to nested `select`/`selectOne`/
 * `count` queries to be `LATERAL JOIN`ed, or a single `select`/`selectOne`/
 * `count` query whose result will be passed through directly as the result of
 * the containing query
 * * `alias` — table alias (string): required if using `lateral` to join a table
 * to itself
 * * `extras` — an object mapping key(s) to `SqlFragment`s, so that derived
 * quantities can be included in the JSON result
 * @param mode (Used internally by `selectOne` and `count`)
 */
export const select: SelectSignatures = function (
  table: Table,
  where: Whereable | SqlFragment<any> | AllType = all,
  options: SelectOptionsForTable<Table, ColumnsOption<Table>, LateralOption<ColumnsOption<Table>, ExtrasOption<Table>>, ExtrasOption<Table>, any> = {},
  mode: SelectResultMode = SelectResultMode.Many,
  aggregate: string = "count",
) {
  const isLimitOne = mode === SelectResultMode.One || mode === SelectResultMode.ExactlyOne;
  const allOptions = isLimitOne ? { ...options, limit: 1 } : options;
  const alias = allOptions.alias || table;
  const { distinct, groupBy, having, lateral, columns, extras } = allOptions;

  const lock = allOptions.lock === undefined || Array.isArray(allOptions.lock) ? allOptions.lock : [allOptions.lock];
  const order = allOptions.order === undefined || Array.isArray(allOptions.order) ? allOptions.order : [allOptions.order];

  const tableAliasSql = alias === table ? [] : sql<string>` AS ${alias}`;
  const distinctSql = !distinct
    ? []
    : sql` DISTINCT${distinct instanceof SqlFragment || typeof distinct === "string" ? sql` ON (${distinct})` : Array.isArray(distinct) ? sql` ON (${cols(distinct)})` : []}`;

  const colsSql =
    lateral instanceof SqlFragment
      ? []
      : mode === SelectResultMode.Numeric
        ? columns
          ? sql`${raw(aggregate)}(${cols(columns)})`
          : sql`${raw(aggregate)}(*)`
        : SqlForColumnsOfTable(columns, alias as Table);

  const colsExtraSql = lateral instanceof SqlFragment || mode === SelectResultMode.Numeric ? [] : SqlForExtras(extras);

  const colsLateralSql =
    lateral === undefined || mode === SelectResultMode.Numeric
      ? []
      : lateral instanceof SqlFragment
        ? sql`"lateral_passthru".result`
        : sql` || jsonb_build_object(${mapWithSeparator(Object.keys(lateral).sort(), sql`, `, (k) => sql`${param(k)}::text, "lateral_${raw(k)}".result`)})`;

  const allColsSql = sql`${colsSql}${colsExtraSql}${colsLateralSql}`;
  const whereSql = where === all ? [] : sql` WHERE ${where}`;
  const groupBySql = !groupBy ? [] : sql` GROUP BY ${groupBy instanceof SqlFragment || typeof groupBy === "string" ? groupBy : cols(groupBy)}`;
  const havingSql = !having ? [] : sql` HAVING ${having}`;

  const orderSql =
    order === undefined
      ? []
      : sql` ORDER BY ${mapWithSeparator(order as OrderSpecForTable<Table>[], sql`, `, (o) => {
          // `as` clause is required when TS not strict
          if (!["ASC", "DESC"].includes(o.direction)) {
            throw new Error(`Direction must be ASC/DESC, not '${o.direction}'`);
          }

          if (o.nulls && !["FIRST", "LAST"].includes(o.nulls)) {
            throw new Error(`Nulls must be FIRST/LAST/undefined, not '${o.nulls}'`);
          }

          return sql`${o.by as any} ${raw(o.direction)}${o.nulls ? sql` NULLS ${raw(o.nulls)}` : []}`;
        })}`;

  const limitSql = allOptions.limit === undefined ? [] : allOptions.withTies ? sql` FETCH FIRST ${param(allOptions.limit)} ROWS WITH TIES` : sql` LIMIT ${param(allOptions.limit)}`; // compatibility with pg pre-10.5; and fewer bytes!
  const offsetSql = allOptions.offset === undefined ? [] : sql` OFFSET ${param(allOptions.offset)}`; // pg is lax about OFFSET following FETCH, and we exploit that

  const lockSql =
    lock === undefined
      ? []
      : (lock as SelectLockingOptions<string>[]).map((lock) => {
          // `as` clause is required when TS not strict
          const ofTables = lock.of === undefined || Array.isArray(lock.of) ? lock.of : [lock.of],
            ofClause = ofTables === undefined ? [] : sql` OF ${mapWithSeparator(ofTables as Table[], sql`, `, (t) => t)}`; // `as` clause is required when TS not strict
          return sql` FOR ${raw(lock.for)}${ofClause}${lock.wait ? sql` ${raw(lock.wait)}` : []}`;
        });

  const lateralSql =
    lateral === undefined
      ? []
      : lateral instanceof SqlFragment
        ? (() => {
            return sql` LEFT JOIN LATERAL (${lateral.copy({ parentTable: alias })}) AS "lateral_passthru" ON true`;
          })()
        : Object.keys(lateral)
            .sort()
            .map((k) => {
              /// enables `parent('column')` in subquery's Whereables
              const subQ = lateral[k]?.copy({ parentTable: alias })!;
              return sql` LEFT JOIN LATERAL (${subQ}) AS "lateral_${raw(k)}" ON true`;
            });

  const rowsQuery = sql<
    Sql,
    any
  >`SELECT ${distinctSql} ${allColsSql} AS result FROM ${table} ${tableAliasSql} ${lateralSql} ${whereSql} ${groupBySql} ${havingSql} ${orderSql} ${limitSql} ${offsetSql} ${lockSql}`;

  const query =
    mode !== SelectResultMode.Many
      ? rowsQuery
      : // we need the aggregate to sit in a sub-SELECT in order to keep ORDER and LIMIT working as usual
        sql<Sql, any>` SELECT coalesce(jsonb_agg(result), '[]') AS result FROM (${rowsQuery}) AS ${raw(`"sq_${alias}"`)}`;

  switch (mode) {
    case SelectResultMode.Numeric:
      // note: pg deliberately returns strings for int8 in case 64-bit numbers overflow
      // (see https://github.com/brianc/node-pg-types#use), but we assume our counts aren't that big
      query.runResultTransform = function transformResult(queryResult) {
        return Number(queryResult.rows[0].result);
      };
      break;

    case SelectResultMode.ExactlyOne:
      query.runResultTransform = function transformResult(queryResult) {
        assert(queryResult.rows.length === 1);
        const result = queryResult.rows[0]?.result;
        assert(result === undefined, new NotExactlyOneError(query, "One result expected but none returned (hint: check `.query.compile()` on this Error)"));
        return toCamelCaseKeys(result);
      };
      break;

    default:
      // SelectResultMode.One or SelectResultMode.Many
      query.runResultTransform = function transformResult(queryResult) {
        return toCamelCaseKeys(queryResult.rows[0]?.result);
      };
  }

  // query.runResultTransform =
  //   mode === SelectResultMode.Numeric
  //     ? // note: pg deliberately returns strings for int8 in case 64-bit numbers overflow
  //       // (see https://github.com/brianc/node-pg-types#use), but we assume our counts aren't that big
  //       function transformResult(queryResult) {
  //         return Number(queryResult.rows[0].result);
  //       }
  //     : mode === SelectResultMode.ExactlyOne
  //       ? function transformResult(queryResult) {
  //           const result = queryResult.rows[0]?.result;
  //           if (result === undefined) {
  //             throw new NotExactlyOneError(query, "One result expected but none returned (hint: check `.query.compile()` on this Error)");
  //           }
  //           return result;
  //         }
  //       : // SelectResultMode.One or SelectResultMode.Many
  //         function transformResult(queryResult) {
  //           return queryResult.rows[0]?.result;
  //         };

  return query;
};

/* === selectOne === */

export type SelectOneSignatures = <T extends Table, C extends ColumnsOption<T>, L extends LateralOption<C, E>, E extends ExtrasOption<T>, A extends string>(
  table: T,
  where: WhereableForTable<T> | SqlFragment<any> | AllType,
  options?: SelectOptionsForTable<T, C, L, E, A>,
) => SqlFragment<FullSelectReturnTypeForTable<T, C, L, E, SelectResultMode.One>>;

/**
 * Generate a `SELECT` query `SqlFragment` that returns only a single result (or
 * undefined). A `LIMIT 1` clause is added automatically. This can be nested with
 * other `select`/`selectOne`/`count` queries using the `lateral` option.
 * @param table The table to select from
 * @param where A `Whereable` or `SqlFragment` defining the rows to be selected,
 * or `all`
 * @param options Options object. See documentation for `select` for details.
 */
export const selectOne: SelectOneSignatures = function (table, where, options = {}) {
  // you might argue that 'selectOne' offers little that you can't get with
  // destructuring assignment and plain 'select'
  // -- e.g.let[x] = async select(...).run(pool); -- but something worth having
  // is '| undefined' in the return signature, because the result of indexing
  // never includes undefined (until 4.1 and --noUncheckedIndexedAccess)
  // (see https://github.com/Microsoft/TypeScript/issues/13778)

  return select(table, where, options, SelectResultMode.One);
};

/* === selectExactlyOne === */

export type SelectExactlyOneSignatures = <T extends Table, C extends ColumnsOption<T>, L extends LateralOption<C, E>, E extends ExtrasOption<T>, A extends string>(
  table: T,
  where: WhereableForTable<T> | SqlFragment<any> | AllType,
  options?: SelectOptionsForTable<T, C, L, E, A>,
) => SqlFragment<FullSelectReturnTypeForTable<T, C, L, E, SelectResultMode.ExactlyOne>>;

/**
 * Generate a `SELECT` query `SqlFragment` that returns a single result or
 * throws an error. A `LIMIT 1` clause is added automatically. This can be
 * nested with other `select`/`selectOne`/`count` queries using the `lateral`
 * option.
 * @param table The table to select from
 * @param where A `Whereable` or `SqlFragment` defining the rows to be selected,
 * or `all`
 * @param options Options object. See documentation for `select` for details.
 */

export const selectExactlyOne: SelectExactlyOneSignatures = function (table, where, options = {}) {
  return select(table, where, options, SelectResultMode.ExactlyOne);
};

/* === count, sum, avg === */

export type NumericAggregateSignatures = <T extends Table, C extends ColumnsOption<T>, L extends LateralOption<C, E>, E extends ExtrasOption<T>, A extends string>(
  table: T,
  where: WhereableForTable<T> | SqlFragment<any> | AllType,
  options?: SelectOptionsForTable<T, C, L, E, A>,
) => SqlFragment<number>;

/**
 * Generate a `SELECT` query `SqlFragment` that returns a count. This can be
 * nested in other `select`/`selectOne` queries using their `lateral` option.
 * @param table The table to count from
 * @param where A `Whereable` or `SqlFragment` defining the rows to be counted,
 * or `all`
 * @param options Options object. Useful keys may be: `columns`, `alias`.
 */
export const count: NumericAggregateSignatures = function (table, where, options?) {
  return select(table, where, options, SelectResultMode.Numeric);
};

/**
 * Generate a `SELECT` query `SqlFragment` that returns a sum. This can be
 * nested in other `select`/`selectOne` queries using their `lateral` option.
 * @param table The table to aggregate from
 * @param where A `Whereable` or `SqlFragment` defining the rows to be
 * aggregated, or `all`
 * @param options Options object. Useful keys may be: `columns`, `alias`.
 */
export const sum: NumericAggregateSignatures = function (table, where, options?) {
  return select(table, where, options, SelectResultMode.Numeric, "sum");
};

/**
 * Generate a `SELECT` query `SqlFragment` that returns an arithmetic mean via
 * the `avg` aggregate function. This can be nested in other `select`/
 * `selectOne` queries using their `lateral` option.
 * @param table The table to aggregate from
 * @param where A `Whereable` or `SqlFragment` defining the rows to be
 * aggregated, or `all`
 * @param options Options object. Useful keys may be: `columns`, `alias`.
 */
export const avg: NumericAggregateSignatures = function (table, where, options?) {
  return select(table, where, options, SelectResultMode.Numeric, "avg");
};

/**
 * Generate a `SELECT` query `SqlFragment` that returns a minimum via the `min`
 * aggregate function. This can be nested in other `select`/`selectOne` queries
 * using their `lateral` option.
 * @param table The table to aggregate from
 * @param where A `Whereable` or `SqlFragment` defining the rows to be
 * aggregated, or `all`
 * @param options Options object. Useful keys may be: `columns`, `alias`.
 */
export const min: NumericAggregateSignatures = function (table, where, options?) {
  return select(table, where, options, SelectResultMode.Numeric, "min");
};

/**
 * Generate a `SELECT` query `SqlFragment` that returns a maximum via the `max`
 * aggregate function. This can be nested in other `select`/`selectOne` queries
 * using their `lateral` option.
 * @param table The table to aggregate from
 * @param where A `Whereable` or `SqlFragment` defining the rows to be
 * aggregated, or `all`
 * @param options Options object. Useful keys may be: `columns`, `alias`.
 */
export const max: NumericAggregateSignatures = function (table, where, options?) {
  return select(table, where, options, SelectResultMode.Numeric, "max");
};
