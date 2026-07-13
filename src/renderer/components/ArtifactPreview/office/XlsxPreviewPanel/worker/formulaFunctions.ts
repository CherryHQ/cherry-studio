/**
 * Custom function patch for fast-formula-parser@1.0.19.
 *
 * This version registers several very common statistical aggregate functions as empty stubs (`() => {}` returning
 * undefined). The library then throws `#NAME? "... is not implemented"`, which appears as "formula not evaluated" in
 * preview. This fills those functions through the FormulaParser constructor's `functions` option. The merge order is
 * after built-ins, so these implementations override the library's same-name stubs; see grammar/hooks.js.
 *
 * Only numeric aggregates that can be implemented correctly with `flattenParams` are patched here:
 * MAX MIN MEDIAN COUNTA LARGE SMALL MODE.SNGL STDEV.S STDEV.P VAR.S VAR.P.
 * More complex functions that depend on range lookup or condition parsing, such as SUMIFS/COUNTIFS/MATCH/SUBTOTAL,
 * are out of scope for this change.
 */
import type { FunctionArg, ParserFunction } from 'fast-formula-parser'
import FormulaParser from 'fast-formula-parser'

const H = FormulaParser.FormulaHelpers
const { NUMBER } = FormulaParser.Types
const FormulaError = FormulaParser.FormulaError
const IS_GREATER = (value: number, current: number): boolean => value > current
const IS_LESS = (value: number, current: number): boolean => value < current

/** Flatten all arguments and collect numeric scalars only. Text, empty cells, and booleans follow Excel aggregate semantics. */
function collectNumbers(params: FunctionArg[]): number[] {
  const nums: number[] = []
  H.flattenParams(params, NUMBER, true, (item) => {
    if (typeof item === 'number' && !Number.isNaN(item)) nums.push(item)
  })
  return nums
}

/** MAX/MIN: scan flattened numeric inputs once without allocating an intermediate array or spreading function args. */
function findExtremum(params: FunctionArg[], isBetter: (value: number, current: number) => boolean): number {
  let found = false
  let result = 0
  H.flattenParams(params, NUMBER, true, (item) => {
    if (typeof item !== 'number' || Number.isNaN(item)) return
    if (!found || isBetter(item, result)) {
      result = item
      found = true
    }
  })
  return found ? result : 0
}

/** Sum of squared deviations, reused by variance and standard deviation. */
function sumOfSquares(nums: number[]): number {
  const mean = nums.reduce((sum, x) => sum + x, 0) / nums.length
  return nums.reduce((sum, x) => sum + (x - mean) * (x - mean), 0)
}

/** LARGE/SMALL: sort and return the kth value. Out-of-range k or no numeric values throws #NUM!. */
function nthOrdered(params: FunctionArg[], k: FunctionArg, compare: (a: number, b: number) => number): number {
  const nums = collectNumbers([params[0]]).sort(compare)
  const index = Math.trunc(H.accept(k, NUMBER) as number)
  if (nums.length === 0 || index < 1 || index > nums.length) throw FormulaError.NUM
  return nums[index - 1]
}

export const CUSTOM_FORMULA_FUNCTIONS: Record<string, ParserFunction> = {
  MAX: (...params) => findExtremum(params, IS_GREATER),
  MIN: (...params) => findExtremum(params, IS_LESS),
  MEDIAN: (...params) => {
    const nums = collectNumbers(params).sort((a, b) => a - b)
    if (nums.length === 0) throw FormulaError.NUM
    const mid = Math.floor(nums.length / 2)
    return nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
  },
  COUNTA: (...params) => {
    let count = 0
    H.flattenParams(params, null, true, (item) => {
      if (item !== null && item !== undefined) count++
    })
    return count
  },
  LARGE: (array, k) => nthOrdered([array], k, (a, b) => b - a),
  SMALL: (array, k) => nthOrdered([array], k, (a, b) => a - b),
  'MODE.SNGL': (...params) => {
    const nums = collectNumbers(params)
    const counts = new Map<number, number>()
    let mode = 0
    let modeCount = 0
    for (const x of nums) {
      const c = (counts.get(x) ?? 0) + 1
      counts.set(x, c)
      if (c > modeCount) {
        modeCount = c
        mode = x
      }
    }
    if (modeCount < 2) throw FormulaError.NA
    return mode
  },
  'STDEV.S': (...params) => {
    const nums = collectNumbers(params)
    if (nums.length < 2) throw FormulaError.DIV0
    return Math.sqrt(sumOfSquares(nums) / (nums.length - 1))
  },
  'STDEV.P': (...params) => {
    const nums = collectNumbers(params)
    if (nums.length < 1) throw FormulaError.DIV0
    return Math.sqrt(sumOfSquares(nums) / nums.length)
  },
  'VAR.S': (...params) => {
    const nums = collectNumbers(params)
    if (nums.length < 2) throw FormulaError.DIV0
    return sumOfSquares(nums) / (nums.length - 1)
  },
  'VAR.P': (...params) => {
    const nums = collectNumbers(params)
    if (nums.length < 1) throw FormulaError.DIV0
    return sumOfSquares(nums) / nums.length
  }
}
