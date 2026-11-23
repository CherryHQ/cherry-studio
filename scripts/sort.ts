type CatalogValue = string | number | boolean | null | undefined | CatalogValue[] | Catalog

type Catalog = { [key: string]: CatalogValue }

// https://github.com/Gudahtt/prettier-plugin-sort-json/blob/main/src/index.ts
/**
 * Lexical sort function for strings, meant to be used as the sort
 * function for `Array.prototype.sort`.
 *
 * @param a - First element to compare.
 * @param b - Second element to compare.
 * @returns A number indicating which element should come first.
 */
function lexicalSort(a: string, b: string): number {
  if (a > b) {
    return 1
  }

  if (a < b) {
    return -1
  }

  return 0
}

/**
 * 对对象的键按照字典序进行排序（支持嵌套对象）
 * @param obj 需要排序的对象
 * @returns 返回排序后的新对象
 */
export function sortedObjectByKeys(obj: Catalog): Catalog {
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- Recursion preserves catalog values and arrays while rebuilding sorted own keys, including __proto__.
  return Object.fromEntries(
    Object.keys(obj)
      .sort(lexicalSort)
      .map((key): [string, CatalogValue] => {
        const value = obj[key]

        return [
          key,
          typeof value === 'object' && value !== null && !Array.isArray(value) ? sortedObjectByKeys(value) : value
        ]
      })
  )
}
