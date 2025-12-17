import { describe, expect, it } from 'vitest'

import { getDifference, getIntersection, getUnion } from '../collection'

describe('Collection Utils', () => {
  // ================== Basic Types Tests ==================

  describe('getIntersection - Basic Types', () => {
    it('should get intersection of number arrays', () => {
      const arr1 = [1, 2, 3, 4]
      const arr2 = [3, 4, 5, 6]
      const result = getIntersection(arr1, arr2)
      expect(result).toEqual([3, 4])
    })

    it('should get intersection of string arrays', () => {
      const arr1 = ['a', 'b', 'c']
      const arr2 = ['b', 'c', 'd']
      const result = getIntersection(arr1, arr2)
      expect(result).toEqual(['b', 'c'])
    })

    it('should return empty array when no intersection', () => {
      const arr1 = [1, 2, 3]
      const arr2 = [4, 5, 6]
      const result = getIntersection(arr1, arr2)
      expect(result).toEqual([])
    })

    it('should return empty array when one array is empty', () => {
      const arr1 = [1, 2, 3]
      const arr2: number[] = []
      const result = getIntersection(arr1, arr2)
      expect(result).toEqual([])
    })

    it('should return empty array when both arrays are empty', () => {
      const arr1: number[] = []
      const arr2: number[] = []
      const result = getIntersection(arr1, arr2)
      expect(result).toEqual([])
    })
  })

  describe('getDifference - Basic Types', () => {
    it('should get difference of number arrays', () => {
      const arr1 = [1, 2, 3, 4]
      const arr2 = [3, 4, 5, 6]
      const result = getDifference(arr1, arr2)
      expect(result).toEqual([1, 2])
    })

    it('should get difference of string arrays', () => {
      const arr1 = ['a', 'b', 'c']
      const arr2 = ['b', 'c', 'd']
      const result = getDifference(arr1, arr2)
      expect(result).toEqual(['a'])
    })

    it('should return empty array when no difference', () => {
      const arr1 = [1, 2, 3]
      const arr2 = [1, 2, 3, 4, 5]
      const result = getDifference(arr1, arr2)
      expect(result).toEqual([])
    })

    it('should return first array when second array is empty', () => {
      const arr1 = [1, 2, 3]
      const arr2: number[] = []
      const result = getDifference(arr1, arr2)
      expect(result).toEqual([1, 2, 3])
    })
  })

  describe('getUnion - Basic Types', () => {
    it('should merge number arrays correctly', () => {
      const arr1 = [1, 2, 3]
      const arr2 = [3, 4, 5]
      const result = getUnion(arr1, arr2)
      expect(result).toEqual([1, 2, 3, 4, 5])
    })

    it('should merge string arrays correctly', () => {
      const arr1 = ['a', 'b']
      const arr2 = ['b', 'c']
      const result = getUnion(arr1, arr2)
      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('should merge arrays with no duplicates', () => {
      const arr1 = [1, 2]
      const arr2 = [3, 4]
      const result = getUnion(arr1, arr2)
      expect(result).toEqual([1, 2, 3, 4])
    })

    it('should return other array when one is empty', () => {
      const arr1 = [1, 2, 3]
      const arr2: number[] = []
      const result = getUnion(arr1, arr2)
      expect(result).toEqual([1, 2, 3])
    })
  })

  // ================== Object Types Tests - Key Selector ==================

  interface User {
    id: number
    name: string
    age: number
  }

  const users1: User[] = [
    { id: 1, name: 'Alice', age: 25 },
    { id: 2, name: 'Bob', age: 30 },
    { id: 3, name: 'Charlie', age: 35 }
  ]

  const users2: User[] = [
    { id: 2, name: 'Bob', age: 30 },
    { id: 3, name: 'Charlie', age: 36 },
    { id: 4, name: 'David', age: 28 }
  ]

  describe('getIntersection - Object Types (Key Selector)', () => {
    it('should get user intersection by id', () => {
      const result = getIntersection(users1, users2, (user) => user.id)
      expect(result).toEqual([
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 }
      ])
    })

    it('should get user intersection by name', () => {
      const result = getIntersection(users1, users2, (user) => user.name)
      expect(result).toEqual([
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 }
      ])
    })

    it('should return empty array when no intersection', () => {
      const users3: User[] = [{ id: 5, name: 'Eve', age: 40 }]
      const result = getIntersection(users1, users3, (user) => user.id)
      expect(result).toEqual([])
    })
  })

  describe('getDifference - Object Types (Key Selector)', () => {
    it('should get user difference by id', () => {
      const result = getDifference(users1, users2, (user) => user.id)
      expect(result).toEqual([{ id: 1, name: 'Alice', age: 25 }])
    })

    it('should get user difference by name', () => {
      const result = getDifference(users1, users2, (user) => user.name)
      expect(result).toEqual([{ id: 1, name: 'Alice', age: 25 }])
    })

    it('should return correct difference', () => {
      const result = getDifference(users2, users1, (user) => user.id)
      expect(result).toEqual([{ id: 4, name: 'David', age: 28 }])
    })
  })

  describe('getUnion - Object Types (Key Selector)', () => {
    it('should merge user arrays by id', () => {
      const result = getUnion(users1, users2, (user) => user.id)
      expect(result).toEqual([
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
        { id: 4, name: 'David', age: 28 }
      ])
    })

    it('should preserve first array element version', () => {
      const result = getUnion(users1, users2, (user) => user.id)
      const charlie = result.find((u) => u.id === 3)
      expect(charlie?.age).toBe(35)
    })
  })

  // ================== Object Types Tests - Comparator Function ==================

  describe('getIntersection - Object Types (Comparator)', () => {
    it('should use custom comparator correctly', () => {
      const result = getIntersection(users1, users2, (a, b) => a.id === b.id && a.name === b.name)
      expect(result).toEqual([
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 }
      ])
    })

    it('should get users with similar age', () => {
      const youngUsers: User[] = [
        { id: 5, name: 'Eve', age: 26 },
        { id: 6, name: 'Frank', age: 32 }
      ]

      const result = getIntersection(users1, youngUsers, (a, b) => Math.abs(a.age - b.age) <= 5)

      expect(result).toEqual([
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 }
      ])
    })
  })

  describe('getDifference - Object Types (Comparator)', () => {
    it('should use custom comparator for difference', () => {
      const result = getDifference(users1, users2, (a, b) => a.id === b.id && a.name === b.name)
      expect(result).toEqual([{ id: 1, name: 'Alice', age: 25 }])
    })

    it('should consider all properties in comparison', () => {
      const result = getDifference(users1, users2, (a, b) => a.id === b.id && a.name === b.name && a.age === b.age)
      expect(result).toEqual([
        { id: 1, name: 'Alice', age: 25 },
        { id: 3, name: 'Charlie', age: 35 }
      ])
    })
  })

  describe('getUnion - Object Types (Comparator)', () => {
    it('should merge arrays using custom comparator', () => {
      const result = getUnion(users1, users2, (a, b) => a.id === b.id)
      expect(result).toEqual([
        { id: 1, name: 'Alice', age: 25 },
        { id: 2, name: 'Bob', age: 30 },
        { id: 3, name: 'Charlie', age: 35 },
        { id: 4, name: 'David', age: 28 }
      ])
    })

    it('should handle complex comparison logic', () => {
      const products1 = [
        { id: 1, category: 'electronics', price: 100 },
        { id: 2, category: 'books', price: 20 }
      ]

      const products2 = [
        { id: 3, category: 'electronics', price: 150 },
        { id: 4, category: 'clothing', price: 50 }
      ]

      const result = getUnion(products1, products2, (a, b) => a.category === b.category)

      expect(result).toEqual([
        { id: 1, category: 'electronics', price: 100 },
        { id: 2, category: 'books', price: 20 },
        { id: 4, category: 'clothing', price: 50 }
      ])
    })
  })

  // ================== Edge Cases ==================

  describe('Edge Cases', () => {
    it('should handle identical arrays', () => {
      const arr = [1, 2, 3]

      expect(getIntersection(arr, arr)).toEqual([1, 2, 3])
      expect(getDifference(arr, arr)).toEqual([])
      expect(getUnion(arr, arr)).toEqual([1, 2, 3])
    })

    it('should handle arrays with duplicates', () => {
      const arr1 = [1, 1, 2, 2, 3]
      const arr2 = [2, 2, 3, 3, 4]

      expect(getIntersection(arr1, arr2)).toEqual([2, 2, 3])
      expect(getDifference(arr1, arr2)).toEqual([1, 1])
      expect(getUnion(arr1, arr2)).toEqual([1, 2, 3, 4])
    })

    it('should handle object array duplicates with key selector', () => {
      const arr1 = [
        { id: 1, name: 'A' },
        { id: 1, name: 'A' },
        { id: 2, name: 'B' }
      ]
      const arr2 = [
        { id: 2, name: 'B' },
        { id: 3, name: 'C' }
      ]

      const intersection = getIntersection(arr1, arr2, (item) => item.id)
      expect(intersection).toEqual([{ id: 2, name: 'B' }])

      const union = getUnion(arr1, arr2, (item) => item.id)
      expect(union).toEqual([
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' }
      ])
    })
  })

  // ================== Type Safety Tests ==================

  describe('Type Safety', () => {
    it('should correctly infer return types', () => {
      const numbers = [1, 2, 3]
      const strings = ['a', 'b', 'c']

      const numberResult = getIntersection(numbers, numbers)
      const stringResult = getIntersection(strings, strings)

      expect(typeof numberResult[0]).toBe('number')
      expect(typeof stringResult[0]).toBe('string')
    })

    it('should support complex object types', () => {
      interface ComplexObject {
        nested: {
          value: number
        }
        array: string[]
      }

      const complex1: ComplexObject[] = [
        { nested: { value: 1 }, array: ['a'] },
        { nested: { value: 2 }, array: ['b'] }
      ]

      const complex2: ComplexObject[] = [
        { nested: { value: 2 }, array: ['b'] },
        { nested: { value: 3 }, array: ['c'] }
      ]

      const result = getIntersection(complex1, complex2, (obj) => obj.nested.value)
      expect(result).toEqual([{ nested: { value: 2 }, array: ['b'] }])
    })

    it('should demonstrate why objects need comparators', () => {
      const obj1 = [{ id: 1, name: 'Alice' }]
      const obj2 = [{ id: 1, name: 'Alice' }]

      // Bypass TypeScript type checking with 'any' to show runtime behavior
      const anyObj1 = obj1 as any
      const anyObj2 = obj2 as any

      // Without comparator, objects are compared by reference, not content
      const result = getIntersection(anyObj1, anyObj2)
      expect(result).toEqual([])

      // With proper key selector, it works correctly
      const correctResult = getIntersection(obj1, obj2, (item) => item.id)
      expect(correctResult).toEqual([{ id: 1, name: 'Alice' }])
    })

    it('should enforce type constraints at compile time', () => {
      const obj1 = [{ id: 1, name: 'Alice' }]
      const obj2 = [{ id: 1, name: 'Alice' }]

      // The following would cause TypeScript compilation errors:
      //
      // ❌ Error: Type '{ id: number; name: string; }' does not satisfy the constraint 'string | number | boolean | null | undefined'
      // getIntersection(obj1, obj2)
      //
      // ❌ Error: Expected 3 arguments, but got 2. Object types require a comparator.
      // getDifference(obj1, obj2)
      //
      // ❌ Error: Expected 3 arguments, but got 2. Object types require a comparator.
      // getUnion(obj1, obj2)

      // ✅ Correct usage with key selector
      const intersection = getIntersection(obj1, obj2, (item) => item.id)
      const difference = getDifference(obj1, obj2, (item) => item.id)
      const union = getUnion(obj1, obj2, (item) => item.id)

      expect(intersection).toEqual([{ id: 1, name: 'Alice' }])
      expect(difference).toEqual([])
      expect(union).toEqual([{ id: 1, name: 'Alice' }])
    })

    it('should work correctly with primitive types without comparator', () => {
      const nums1 = [1, 2, 3]
      const nums2 = [2, 3, 4]

      const intersection = getIntersection(nums1, nums2)
      expect(intersection).toEqual([2, 3])

      const difference = getDifference(nums1, nums2)
      expect(difference).toEqual([1])

      const union = getUnion(nums1, nums2)
      expect(union).toEqual([1, 2, 3, 4])
    })
  })
})
