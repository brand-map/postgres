/**
 * Simple promisification of setTimeout.
 * @param delay Time to wait, in milliseconds
 */
export const wait = (delay: number) => new Promise(resolve => setTimeout(resolve, delay))

/**
 * Map an input array to an output array, interspersing a constant separator value
 * between the mapped values.
 * @param arr Input array
 * @param separator Separator value
 * @param cb Mapping function
 */
export const mapWithSeparator = <In, Separator, Out>(
  arr: readonly In[],
  separator: Separator,
  callback: (input: In, index: number, inputArray: readonly In[]) => Out
): (Out | Separator)[] => {
  const result: (Out | Separator)[] = []

  for (let i = 0, len = arr.length; i < len; i++) {
    if (i > 0) {
      result.push(separator)
    }
    result.push(callback(arr[i]!, i, arr))
  }

  return result
}

/**
 * Map an array of objects to an output array by taking the union of all objects' keys
 * and ensuring that any key not present on any object gets a default value.
 *
 * `e.g. [{ x: 1 }, { y: 2 }] => [{ x: 1, y: defaultValue }, { x: defaultValue, y: 2}]`
 * @param objects The array of objects
 * @param defaultValue The default value to assign to missing keys for each object
 */
export const completeKeysWithDefaultValue = <T extends object>(objects: T[], defaultValue: any): T[] => {
  const unionKeys = Object.assign({}, ...objects)

  for (const key in unionKeys) {
    unionKeys[key] = defaultValue
  }

  return objects.map(object => {
    const record = { ...unionKeys }
    for (const key in object) {
      if (typeof object[key] === "undefined") {
        continue
      }
      record[key] = object[key]
    }
    return record
  })
}

export function completeKeysWithDefaultValueObject<T extends object>(obj: T, defaultValue: any): T {
  const record = {} as T

  for (const key in obj) {
    if (typeof obj[key] === "undefined") {
      continue
    }
    record[key] = obj[key]
  }

  return record
}

// /**
//  * Test that a value is a Plain Old JavaScript Object (such as one created by an object
//  * literal, e.g. `{x: 1, y: 2}`)
//  * @param x The value to test
//  */
// export const isPojo = (x: any) => typeof x === "object" && x !== null && x.constructor === Object && x.toString() === "[object Object]"
