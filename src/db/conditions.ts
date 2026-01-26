import type { Whereable } from "@brand-map/postgres/schema";

import { SqlFragment, ParentColumn, Parameter, param, sql, type Sql, self, vals } from "./core";
import { mapWithSeparator } from "./utils";

const conditionalParam = (a: any) => (a instanceof SqlFragment || a instanceof ParentColumn || a instanceof Parameter ? a : param(a));

export const isNull = sql<Sql, boolean>`${self} IS NULL`;
export const isNotNull = sql<Sql, boolean>`${self} IS NOT NULL`;
export const isTrue = sql<Sql, boolean>`${self} IS TRUE`;
export const isNotTrue = sql<Sql, boolean>`${self} IS NOT TRUE`;
export const isFalse = sql<Sql, boolean>`${self} IS FALSE`;
export const isNotFalse = sql<Sql, boolean>`${self} IS NOT FALSE`;
export const isUnknown = sql<Sql, boolean>`${self} IS UNKNOWN`;
export const isNotUnknown = sql<Sql, boolean>`${self} IS NOT UNKNOWN`;

export const isDistinctFrom = <T>(a: T) => sql<Sql, boolean, T>`${self} IS DISTINCT FROM ${conditionalParam(a)}`;
export const isNotDistinctFrom = <T>(a: T) => sql<Sql, boolean, T>`${self} IS NOT DISTINCT FROM ${conditionalParam(a)}`;

export const eq = <T>(a: T) => sql<Sql, boolean | null, T>`${self} = ${conditionalParam(a)}`;
export const ne = <T>(a: T) => sql<Sql, boolean | null, T>`${self} <> ${conditionalParam(a)}`;
export const gt = <T>(a: T) => sql<Sql, boolean | null, T>`${self} > ${conditionalParam(a)}`;
export const gte = <T>(a: T) => sql<Sql, boolean | null, T>`${self} >= ${conditionalParam(a)}`;
export const lt = <T>(a: T) => sql<Sql, boolean | null, T>`${self} < ${conditionalParam(a)}`;
export const lte = <T>(a: T) => sql<Sql, boolean | null, T>`${self} <= ${conditionalParam(a)}`;

export const between = <T>(a: T, b: T) => sql<Sql, boolean | null, T>`${self} BETWEEN (${conditionalParam(a)}) AND (${conditionalParam(b)})`;
export const betweenSymmetric = <T>(a: T, b: T) => sql<Sql, boolean | null, T>`${self} BETWEEN SYMMETRIC (${conditionalParam(a)}) AND (${conditionalParam(b)})`;
export const notBetween = <T>(a: T, b: T) => sql<Sql, boolean | null, T>`${self} NOT BETWEEN (${conditionalParam(a)}) AND (${conditionalParam(b)})`;
export const notBetweenSymmetric = <T>(a: T, b: T) => sql<Sql, boolean | null, T>`${self} NOT BETWEEN SYMMETRIC (${conditionalParam(a)}) AND (${conditionalParam(b)})`;

export const like = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${self} LIKE ${conditionalParam(a)}`;
export const notLike = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${self} NOT LIKE ${conditionalParam(a)}`;
export const ilike = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${self} ILIKE ${conditionalParam(a)}`;
export const notIlike = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${self} NOT ILIKE ${conditionalParam(a)}`;
export const similarTo = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${self} SIMILAR TO ${conditionalParam(a)}`;
export const notSimilarTo = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${self} NOT SIMILAR TO ${conditionalParam(a)}`;
export const reMatch = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${self} ~ ${conditionalParam(a)}`;
export const reImatch = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${self} ~* ${conditionalParam(a)}`;
export const notReMatch = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${self} !~ ${conditionalParam(a)}`;
export const notReImatch = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${self} !~* ${conditionalParam(a)}`;

export const isIn = <T>(a: readonly T[]) => (a.length > 0 ? sql<Sql, boolean | null, T>`${self} IN (${vals(a)})` : sql`false`);
export const isNotIn = <T>(a: readonly T[]) => (a.length > 0 ? sql<Sql, boolean | null, T>`${self} NOT IN (${vals(a)})` : sql`true`);

export const or = <T>(...conditions: (SqlFragment<any, T> | Whereable)[]) => sql<Sql, boolean | null, T>`(${mapWithSeparator(conditions, sql` OR `, (c) => c)})`;
export const and = <T>(...conditions: (SqlFragment<any, T> | Whereable)[]) => sql<Sql, boolean | null, T>`(${mapWithSeparator(conditions, sql` AND `, (c) => c)})`;
export const not = <T>(condition: SqlFragment<any, T> | Whereable) => sql<Sql, boolean | null, T>`(NOT ${condition})`;

export const arrayContains = <T>(a: T[] | ParentColumn) => sql<Sql, boolean | null, T>`${self} @> ${conditionalParam(a)}`;
export const arrayContainedIn = <T>(a: T[] | ParentColumn) => sql<Sql, boolean | null, T>`${self} <@ ${conditionalParam(a)}`;
export const arrayOverlaps = <T>(a: T[] | ParentColumn) => sql<Sql, boolean | null, T>`${self} && ${conditionalParam(a)}`;

// things that aren't genuinely conditions
type PluralisingIntervalUnit = "microsecond" | "millisecond" | "second" | "minute" | "hour" | "day" | "week" | "month" | "year" | "decade";
type IntervalUnit = PluralisingIntervalUnit | `${PluralisingIntervalUnit}s` | "century" | "centuries" | "millennium" | "millennia";
export const fromNow = (n: number, unit: IntervalUnit = "millisecond") => sql`now() + ${param(`${String(n)} ${unit}`)}`;
export const after = gt;
export const before = lt;
export const now = sql`now()`;

// these are really more operations than conditions, but we sneak them in here for now, for use e.g. in UPDATE queries
export const add = <T extends number | Date>(a: T) => sql<Sql, number, T>`${self} + ${conditionalParam(a)}`;
export const subtract = <T extends number | Date>(a: T) => sql<Sql, number, T>`${self} - ${conditionalParam(a)}`;
