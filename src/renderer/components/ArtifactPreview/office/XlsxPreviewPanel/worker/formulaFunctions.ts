/**
 * fast-formula-parser@1.0.19 的自定义函数补丁。
 *
 * 该版本把一批**很常用**的统计聚合函数注册成空壳(`() => {}`,返回 undefined),
 * 库据此抛出 `#NAME?`「... is not implemented」——在预览里表现为"公式无法求值"。
 * 这里补齐这批函数,通过 FormulaParser 构造函数的 `functions` 选项注入;合并顺序
 * 在内置函数之后,因此会**覆盖**库内同名空壳(见 grammar/hooks.js 的 functions 合并)。
 *
 * 只补 `flattenParams` 就能正确实现的数值聚合类(库内空壳且高频):
 * MAX MIN MEDIAN COUNTA LARGE SMALL MODE.SNGL STDEV.S STDEV.P VAR.S VAR.P。
 * 依赖区间检索/条件解析的复杂函数(SUMIFS/COUNTIFS/MATCH/SUBTOTAL 等)不在本次范围内。
 */
import type { FunctionArg, ParserFunction } from 'fast-formula-parser'
import FormulaParser from 'fast-formula-parser'

const H = FormulaParser.FormulaHelpers
const { NUMBER } = FormulaParser.Types
const FormulaError = FormulaParser.FormulaError

/** 展平所有实参,只收集数值标量(文本/空单元格/布尔按 Excel 聚合语义忽略) */
function collectNumbers(params: FunctionArg[]): number[] {
  const nums: number[] = []
  H.flattenParams(params, NUMBER, true, (item) => {
    if (typeof item === 'number' && !Number.isNaN(item)) nums.push(item)
  })
  return nums
}

/** 偏差平方和 Σ(x-mean)²,供方差/标准差复用 */
function sumOfSquares(nums: number[]): number {
  const mean = nums.reduce((sum, x) => sum + x, 0) / nums.length
  return nums.reduce((sum, x) => sum + (x - mean) * (x - mean), 0)
}

/** LARGE/SMALL:排序后取第 k 个;k 越界或无数值抛 #NUM! */
function nthOrdered(params: FunctionArg[], k: FunctionArg, compare: (a: number, b: number) => number): number {
  const nums = collectNumbers([params[0]]).sort(compare)
  const index = Math.trunc(H.accept(k, NUMBER) as number)
  if (nums.length === 0 || index < 1 || index > nums.length) throw FormulaError.NUM
  return nums[index - 1]
}

export const CUSTOM_FORMULA_FUNCTIONS: Record<string, ParserFunction> = {
  MAX: (...params) => {
    const nums = collectNumbers(params)
    return nums.length ? Math.max(...nums) : 0
  },
  MIN: (...params) => {
    const nums = collectNumbers(params)
    return nums.length ? Math.min(...nums) : 0
  },
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
