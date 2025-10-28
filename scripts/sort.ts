/**
 * Natural sort function for strings, meant to be used as the sort
 * function for `Array.prototype.sort`.
 *
 * @param a - First element to compare.
 * @param b - Second element to compare.
 * @returns A number indicating which element should come first.
 */
function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Sort object keys in dictionary order (supports nested objects)
 * @param obj The object to be sorted
 * @returns A new object with sorted keys
 */
export function sortedObjectByKeys(obj: object): object {
  const sortedKeys = Object.keys(obj).sort(naturalSort)

  const sortedObj = {}
  for (const key of sortedKeys) {
    let value = obj[key]
    // If the value is an object, sort it recursively
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      value = sortedObjectByKeys(value)
    }
    sortedObj[key] = value
  }

  return sortedObj
}
