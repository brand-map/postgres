import { pad } from "./utils";

/**
 * An ISO8601-formatted date string, such as `"2021-05-25"`.
 */
export type DateString = `${number}-${number}-${number}`; // string; //

/**
 * An ISO8601-formatted time string, such as `"14:41"` or `"14:41:10.249"`.
 */
export type TimeString = `${number}:${number}${"" | `:${number}`}`; // string; //

/**
 * A timezone suffix string, such as `"Z"`, `"-02"`, or `"+01:00"`.
 */
export type TzSuffix = "Z" | `${"+" | "-"}${number}${"" | `:${number}`}`; // string; //

/**
 * A time and timezone string, such as `"14:41:10+02"`. **Postgres docs advise
 * against use of this type except in legacy contexts.**
 */
export type TimeTzString = `${TimeString}${TzSuffix}`; // string; //

/**
 * An ISO8601-formatted date and time string **with no timezone**, such as
 * `"2021-05-25T14:41:10.249097"`.
 */
export type TimestampString = `${DateString}T${TimeString}`; // string; //

/**
 * An ISO8601-formatted date, time and (numeric) timezone string, such as
 * `"2021-05-25T14:41:10.249097+01:00"`.
 */
export type TimestampTzString = `${TimestampString}${TzSuffix}`; // string; //

/**
 * Convert a `TimestampTzString`, `TimestampString` or `DateString` to a
 * JavaScript `Date`. For `TimestampString` and `DateString`, you must specify
 * whether the input is to be interpreted in the JavaScript environment's local
 * time or as UTC.
 *
 * Nullability is preserved (e.g. `TimestampTzString | null` input gives
 * `Date | null` output).
 *
 * _Note:_ Postgres date-time types default to microsecond precision, but must be
 * truncated to the millisecond precision of a JavaScript `Date` here.
 *
 * @param d A `TimestampTzString`, `TimestampString` or `DateString` (or
 * `null`) for conversion.
 * @param tzInterpretation For `TimestampString` or `DateString` input only,
 * `"UTC"` if the input is to be interpreted as UTC or `"local"` if it is to be
 * interpreted in the JavaScript environment's local time
 */
export function toDate(d: null, tzInterpretation?: undefined | "UTC" | "local"): null;
export function toDate<D extends TimestampTzString>(d: D, tzInterpretation?: undefined): Date;
export function toDate<D extends TimestampString | DateString>(d: D, tzInterpretation: "UTC" | "local"): Date;
export function toDate(d: string | null, tzInterpretation?: "UTC" | "local" | undefined) {
  let dateMatch;

  if (d === null) {
    return null;
  }

  switch (tzInterpretation) {
    case undefined:
      return new Date(d);

    case "UTC":
      return new Date(`${d}Z`);

    case "local": {
      // new Date() interprets 'yyyy-mm-dd' as UTC but 'yyyy-mm-ddT00:00' as local
      if ((dateMatch = d.match(/^([0-9]+)-([0-9]+)-([0-9]+)$/))) {
        const [, y, m, d] = dateMatch;
        if (!y || !m || !d) {
          throw new Error("y m d; TODO: proper error");
        }
        return new Date(parseInt(y, 10), parseInt(m, 10) - /* cRaZY jS */ 1, parseInt(d, 10));
      }

      return new Date(d);
    }
  }
}

type DateTimeMap = {
  "timestamptz": TimestampTzString;
  "timestamp:UTC": TimestampString;
  "timestamp:local": TimestampString;
  "date:UTC": DateString;
  "date:local": DateString;
};
type DateTimeMapping<Key extends keyof DateTimeMap> = DateTimeMap[Key];
/**
 * Convert a JavaScript `Date` to a `TimestampTzString`, `TimestampString` or
 * `DateString`.
 *
 * For `TimestampString` and `DateString`, you must specify whether the input
 * is to be expressed in the JavaScript environment's local time or as UTC.
 *
 * Nullability is preserved (e.g. `Date | null` maps to something extending
 * `string | null`).
 *
 * @param d A `Date` (or `null`) for conversion.
 * @param stringTypeTz The pg type corresponding to the desired string format
 * and (except for `timestamptz`) whether to express in UTC or local time. For
 * example: `"timestamptz"`, `"timestamp:local"` or `"date:UTC"`.
 */
export function toString(date: null, stringTypeTz: keyof DateTimeMap): null;
export function toString<T extends keyof DateTimeMap>(date: Date, stringTypeTz: T): DateTimeMapping<T>;
export function toString(date: Date | null, stringTypeTz: keyof DateTimeMap): any {
  if (date === null) {
    return null;
  }

  if (stringTypeTz === "timestamptz") {
    return date.toISOString();
  }

  const [stringType, tz] = stringTypeTz.split(":");

  const utc = tz === "UTC";
  const year = pad(utc ? date.getUTCFullYear() : date.getFullYear(), 4);
  const month = pad((utc ? date.getUTCMonth() : date.getMonth()) + /* cRaZY jS */ 1);
  const day = pad(utc ? date.getUTCDate() : date.getDate());

  if (stringType === "date") {
    return `${year}-${month}-${day}`;
  }

  const hour = pad(utc ? date.getUTCHours() : date.getHours());
  const min = pad(utc ? date.getUTCMinutes() : date.getMinutes());
  const sec = pad(utc ? date.getUTCSeconds() : date.getSeconds());
  const ms = pad(utc ? date.getUTCMilliseconds() : date.getMilliseconds(), 3);

  return `${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}`;
}
