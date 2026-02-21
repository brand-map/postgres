import type * as pgLib from "pg"

import { parse } from "json-custom-numbers"

export function enableCustomJsonParsingForLargeNumbers(pg: typeof pgLib) {
  pg.types.setTypeParser(pg.types.builtins.JSON, parseJsonWithLargeNumbersAsStrings)
  pg.types.setTypeParser(pg.types.builtins.JSONB, parseJsonWithLargeNumbersAsStrings)
}

const { MAX_SAFE_INTEGER, MIN_SAFE_INTEGER } = Number

function parseJsonWithLargeNumbersAsStrings(str: string) {
  return parse(str, undefined, function (_k, str) {
    const num = Number(str) // JSON parser ensures this is an ordinary number, parseInt(str, 10) not needed

    if (num === Infinity || num === -Infinity) {
      return str
    }

    if ((num < MIN_SAFE_INTEGER || num > MAX_SAFE_INTEGER) && str.indexOf(".") === -1) {
      return str
    }

    if (str.length <= 15 || numericStringToExponential(str) === num.toExponential()) {
      return num
    }

    return str
  })
}

const numRe = /^(-?)(0|[1-9][0-9]*?)(0*)([.](0*)([0-9]*?)0*)?([eE]([-+]?)0*([0-9]+))?$/

/**
 * Transform a valid numeric string (any length and precision) into a format
 * that matches Number.prototype.toExponential()
 * @param str A numeric string
 * @returns str The string reformatted to match n.toExponential()
 */
function numericStringToExponential(str: string) {
  const match = str.match(numRe)

  if (!match) {
    throw new Error(`Invalid numeric string: ${str}`)
  }

  const [
    _ /* discard whole match */,
    srcMinus,
    srcDigitsPreDp,
    srcTrailingZeroesPreDp,
    __ /* discard decimal point + following digits */,
    srcLeadingZeroesPostDp,
    srcDigitsPostDp,
    ___ /* discard e + sign + exponent digits */,
    srcSignExp,
    srcDigitsExp
  ] = match

  let exp = srcDigitsExp ? (srcSignExp === "-" ? -srcDigitsExp : Number(srcDigitsExp)) : 0
  let result = srcMinus

  if (srcDigitsPreDp === "0") {
    // n === 0
    if (!srcDigitsPostDp) {
      return "0e+0"
    }

    // n !== 0, -1 < n < 1
    exp -= srcLeadingZeroesPostDp?.length! + 1
    result += srcDigitsPostDp.charAt(0)

    if (srcDigitsPostDp.length > 1) {
      result += `.${srcDigitsPostDp.slice(1)}`
    }
  } else {
    // n <= -1, n >= 1
    exp += srcTrailingZeroesPreDp?.length! + srcDigitsPreDp?.length! - 1
    result += srcDigitsPreDp?.charAt(0)!

    if (srcDigitsPreDp?.length! > 1 || srcDigitsPostDp) {
      result += `.${srcDigitsPreDp?.slice(1)}`
      if (srcDigitsPostDp) {
        result += srcTrailingZeroesPreDp!

        if (srcLeadingZeroesPostDp) {
          result += srcLeadingZeroesPostDp
        }

        result += srcDigitsPostDp
      }
    }
  }

  result += `e${exp >= 0 ? "+" : ""}${exp}`

  return result
}
