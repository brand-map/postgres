import type { Whereable } from "@brand-map/postgres/schema"

import { mapWithSeparator } from "../shared/utils"
import { SqlFragment, ParentColumn, Parameter, param, sql, type Sql, SELF, vals } from "./db-core"

const conditionalParam = (a: any) => (a instanceof SqlFragment || a instanceof ParentColumn || a instanceof Parameter ? a : param(a))

export const isNull = sql<Sql, boolean>`${SELF} IS NULL`
export const isNotNull = sql<Sql, boolean>`${SELF} IS NOT NULL`
export const isTrue = sql<Sql, boolean>`${SELF} IS TRUE`
export const isNotTrue = sql<Sql, boolean>`${SELF} IS NOT TRUE`
export const isFalse = sql<Sql, boolean>`${SELF} IS FALSE`
export const isNotFalse = sql<Sql, boolean>`${SELF} IS NOT FALSE`
export const isUnknown = sql<Sql, boolean>`${SELF} IS UNKNOWN`
export const isNotUnknown = sql<Sql, boolean>`${SELF} IS NOT UNKNOWN`

export const isDistinctFrom = <T>(a: T) => sql<Sql, boolean, T>`${SELF} IS DISTINCT FROM ${conditionalParam(a)}`
export const isNotDistinctFrom = <T>(a: T) => sql<Sql, boolean, T>`${SELF} IS NOT DISTINCT FROM ${conditionalParam(a)}`

export const eq = <T>(a: T) => sql<Sql, boolean | null, T>`${SELF} = ${conditionalParam(a)}`
export const ne = <T>(a: T) => sql<Sql, boolean | null, T>`${SELF} <> ${conditionalParam(a)}`
export const gt = <T>(a: T) => sql<Sql, boolean | null, T>`${SELF} > ${conditionalParam(a)}`
export const gte = <T>(a: T) => sql<Sql, boolean | null, T>`${SELF} >= ${conditionalParam(a)}`
export const lt = <T>(a: T) => sql<Sql, boolean | null, T>`${SELF} < ${conditionalParam(a)}`
export const lte = <T>(a: T) => sql<Sql, boolean | null, T>`${SELF} <= ${conditionalParam(a)}`

export const between = <T>(a: T, b: T) => sql<Sql, boolean | null, T>`${SELF} BETWEEN (${conditionalParam(a)}) AND (${conditionalParam(b)})`
export const betweenSymmetric = <T>(a: T, b: T) => sql<Sql, boolean | null, T>`${SELF} BETWEEN SYMMETRIC (${conditionalParam(a)}) AND (${conditionalParam(b)})`
export const notBetween = <T>(a: T, b: T) => sql<Sql, boolean | null, T>`${SELF} NOT BETWEEN (${conditionalParam(a)}) AND (${conditionalParam(b)})`
export const notBetweenSymmetric = <T>(a: T, b: T) => sql<Sql, boolean | null, T>`${SELF} NOT BETWEEN SYMMETRIC (${conditionalParam(a)}) AND (${conditionalParam(b)})`

export const like = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${SELF} LIKE ${conditionalParam(a)}`
export const notLike = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${SELF} NOT LIKE ${conditionalParam(a)}`
export const ilike = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${SELF} ILIKE ${conditionalParam(a)}`
export const notIlike = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${SELF} NOT ILIKE ${conditionalParam(a)}`
export const similarTo = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${SELF} SIMILAR TO ${conditionalParam(a)}`
export const notSimilarTo = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${SELF} NOT SIMILAR TO ${conditionalParam(a)}`
export const reMatch = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${SELF} ~ ${conditionalParam(a)}`
export const reImatch = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${SELF} ~* ${conditionalParam(a)}`
export const notReMatch = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${SELF} !~ ${conditionalParam(a)}`
export const notReImatch = <T extends string>(a: T) => sql<Sql, boolean | null, T>`${SELF} !~* ${conditionalParam(a)}`

export const isIn = <T>(a: readonly T[]) => (a.length > 0 ? sql<Sql, boolean | null, T>`${SELF} IN (${vals(a)})` : sql`false`)
export const isNotIn = <T>(a: readonly T[]) => (a.length > 0 ? sql<Sql, boolean | null, T>`${SELF} NOT IN (${vals(a)})` : sql`true`)

export const or = <T>(...conditions: (SqlFragment<any, T> | Whereable)[]) => sql<Sql, boolean | null, T>`(${mapWithSeparator(conditions, sql` OR `, c => c)})`
export const and = <T>(...conditions: (SqlFragment<any, T> | Whereable)[]) => sql<Sql, boolean | null, T>`(${mapWithSeparator(conditions, sql` AND `, c => c)})`
export const not = <T>(condition: SqlFragment<any, T> | Whereable) => sql<Sql, boolean | null, T>`(NOT ${condition})`

export const arrayContains = <T>(a: T[] | ParentColumn) => sql<Sql, boolean | null, T>`${SELF} @> ${conditionalParam(a)}`
export const arrayContainedIn = <T>(a: T[] | ParentColumn) => sql<Sql, boolean | null, T>`${SELF} <@ ${conditionalParam(a)}`
export const arrayOverlaps = <T>(a: T[] | ParentColumn) => sql<Sql, boolean | null, T>`${SELF} && ${conditionalParam(a)}`

// things that aren't genuinely conditions
type PluralisingIntervalUnit = "microsecond" | "millisecond" | "second" | "minute" | "hour" | "day" | "week" | "month" | "year" | "decade"
type IntervalUnit = PluralisingIntervalUnit | `${PluralisingIntervalUnit}s` | "century" | "centuries" | "millennium" | "millennia"
export const fromNow = (n: number, unit: IntervalUnit = "millisecond") => sql`now() + ${param(`${String(n)} ${unit}`)}`
export const after = gt
export const before = lt
export const now = sql`now()`

// these are really more operations than conditions, but we sneak them in here for now, for use e.g. in UPDATE queries
export const add = <T extends number | string>(a: T) => sql<Sql, number, T>`${SELF} + ${conditionalParam(a)}`
export const subtract = <T extends number | string>(a: T) => sql<Sql, number, T>`${SELF} - ${conditionalParam(a)}`
