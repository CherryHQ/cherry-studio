// Type-safe collection operations with strict compile-time enforcement

type PrimitiveType = string | number | boolean | null | undefined

// findIntersection - with strict overloads
export function findIntersection<T extends PrimitiveType>(arr1: T[], arr2: T[]): T[]
export function findIntersection<T extends object, K>(arr1: T[], arr2: T[], keySelector: (item: T) => K): T[]
export function findIntersection<T extends object>(arr1: T[], arr2: T[], compareFn: (a: T, b: T) => boolean): T[]
export function findIntersection<T>(
  arr1: T[],
  arr2: T[],
  comparator?: ((item: T) => any) | ((a: T, b: T) => boolean)
): T[] {
  if (!comparator) {
    const set2 = new Set(arr2)
    return arr1.filter((element) => set2.has(element))
  }

  if (comparator.length === 1) {
    const keySelector = comparator as (item: T) => any
    const keySet = new Set(arr2.map(keySelector))
    return arr1.filter((item) => keySet.has(keySelector(item)))
  } else {
    const compareFn = comparator as (a: T, b: T) => boolean
    return arr1.filter((item1) => arr2.some((item2) => compareFn(item1, item2)))
  }
}

// findDifference - with strict overloads
export function findDifference<T extends PrimitiveType>(arr1: T[], arr2: T[]): T[]
export function findDifference<T extends object, K>(arr1: T[], arr2: T[], keySelector: (item: T) => K): T[]
export function findDifference<T extends object>(arr1: T[], arr2: T[], compareFn: (a: T, b: T) => boolean): T[]
export function findDifference<T>(
  arr1: T[],
  arr2: T[],
  comparator?: ((item: T) => any) | ((a: T, b: T) => boolean)
): T[] {
  if (!comparator) {
    const set2 = new Set(arr2)
    return arr1.filter((element) => !set2.has(element))
  }

  if (comparator.length === 1) {
    const keySelector = comparator as (item: T) => any
    const keySet = new Set(arr2.map(keySelector))
    return arr1.filter((item) => !keySet.has(keySelector(item)))
  } else {
    const compareFn = comparator as (a: T, b: T) => boolean
    return arr1.filter((item1) => !arr2.some((item2) => compareFn(item1, item2)))
  }
}

// findUnion - with strict overloads
export function findUnion<T extends PrimitiveType>(arr1: T[], arr2: T[]): T[]
export function findUnion<T extends object, K>(arr1: T[], arr2: T[], keySelector: (item: T) => K): T[]
export function findUnion<T extends object>(arr1: T[], arr2: T[], compareFn: (a: T, b: T) => boolean): T[]
export function findUnion<T>(arr1: T[], arr2: T[], comparator?: ((item: T) => any) | ((a: T, b: T) => boolean)): T[] {
  if (!comparator) {
    return Array.from(new Set([...arr1, ...arr2]))
  }

  if (comparator.length === 1) {
    const keySelector = comparator as (item: T) => any
    const seen = new Set<any>()
    const result: T[] = []

    for (const item of [...arr1, ...arr2]) {
      const key = keySelector(item)
      if (!seen.has(key)) {
        seen.add(key)
        result.push(item)
      }
    }

    return result
  } else {
    const compareFn = comparator as (a: T, b: T) => boolean
    const result = [...arr1]

    for (const item2 of arr2) {
      const exists = result.some((item1) => compareFn(item1, item2))
      if (!exists) {
        result.push(item2)
      }
    }

    return result
  }
}
