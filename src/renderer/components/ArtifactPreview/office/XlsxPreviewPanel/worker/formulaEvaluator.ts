/**
 * 公式 best-effort 求值(三级策略的第 2/3 级;调用方已确认无缓存值才会调 evaluate)。
 * 覆盖错误分类、环检测、memo 和预算控制。
 *
 * fast-formula-parser 实际行为(与该文档描述有出入之处,已用 node 直接探测确认,
 * 详见完成报告):
 * - `parser.parse()` 对"合法 Excel 错误结果"——#DIV/0! #VALUE! #N/A #NUM! #NULL! #REF!,
 *   以及作为裸标识符出现的未知具名区域(#NAME?)——是**返回**一个 FormulaError 实例,不抛出。
 * - 未知函数调用(如 `FOOBAR(1)`)、语法/词法错误、以及 onCell/onRange 回调内部抛出的
 *   任何异常,都会被包装成 FormulaError('#ERROR!', ...) 并**抛出**,而不是返回 #NAME?。
 *   因此"未知函数 → unevaluated"在本实现中是通过"任何 parse() 抛出 → unevaluated"的
 *   兜底规则覆盖的,并不依赖抛出对象的错误码。
 * - 是否抛出与"合法错误码"这两类之间的边界,和 03 文档 §2 表格描述的语义一致
 *   (只是"#NAME?"在库里可能来自返回值也可能来自被包装的抛出,两种情况本实现都归为
 *   unevaluated,与文档结果相符)。
 */
import type { ParserCellRef, ParserRangeRef } from 'fast-formula-parser'
import FormulaParser from 'fast-formula-parser'

import { CUSTOM_FORMULA_FUNCTIONS } from './formulaFunctions'

export interface FormulaCellRef {
  sheet: string
  row: number
  col: number
}

export interface EvalContext {
  /** 返回单元格原始值(公式单元格返回其求值结果;触发递归求值) */
  getCellValue(ref: FormulaCellRef): string | number | boolean | null
}

export interface EvalOutcome {
  state: 'evaluated' | 'unevaluated'
  /** evaluated 时必有(#DIV/0! 等合法错误结果以 string 表达) */
  value?: string | number | boolean | null
}

export interface FormulaEvaluator {
  evaluate(formula: string, pos: FormulaCellRef): EvalOutcome
}

/** 递归深度上限:防深链公式爆栈 */
const MAX_DEPTH = 64

/** parse() 返回的合法 Excel 错误码中,视为"求值器不支持/无法解析"而非合法结果的一类 */
const UNEVALUATED_ERROR_CODES = new Set(['#NAME?'])

const UNEVALUATED_OUTCOME: EvalOutcome = { state: 'unevaluated' }

function makeKey(ref: FormulaCellRef): string {
  return `${ref.sheet}!${ref.row}:${ref.col}`
}

/** parse() 的原始返回值 → 单元格标量值(EvalOutcome.value 的取值范围) */
function normalizeValue(result: unknown): string | number | boolean | null {
  if (result === null || result === undefined) return null
  if (typeof result === 'number' || typeof result === 'string' || typeof result === 'boolean') {
    return result
  }
  // 理论上 parser 已经把 array/range/union 等归一为标量或 FormulaError,
  // 走到这里说明遇到了未预期的返回形态,保守按无法求值处理(调用方兜底判断)。
  return null
}

export function createFormulaEvaluator(ctx: EvalContext, budgetMs: number): FormulaEvaluator {
  const deadline = Date.now() + budgetMs

  /** 已完成求值的单元格结果缓存,key = "sheet!row:col" */
  const memo = new Map<string, EvalOutcome>()
  /** 当前调用栈上正在求值的单元格(环检测) */
  const visiting = new Set<string>()
  /** 本轮检测到属于某个环的 key,待其所在帧结束时强制改判为 unevaluated */
  const cyclicKeys = new Set<string>()

  function markCycle(key: string): void {
    const stack = [...visiting]
    const idx = stack.indexOf(key)
    const cycleMembers = idx === -1 ? stack : stack.slice(idx)
    for (const member of cycleMembers) {
      cyclicKeys.add(member)
    }
  }

  function classifyParseResult(result: unknown): EvalOutcome {
    if (result instanceof FormulaParser.FormulaError) {
      if (UNEVALUATED_ERROR_CODES.has(result.error)) {
        return UNEVALUATED_OUTCOME
      }
      return { state: 'evaluated', value: result.error }
    }
    return { state: 'evaluated', value: normalizeValue(result) }
  }

  function evaluate(formula: string, pos: FormulaCellRef): EvalOutcome {
    const key = makeKey(pos)

    const memoized = memo.get(key)
    if (memoized) return memoized

    if (Date.now() >= deadline) {
      // 预算耗尽:后续所有未求值单元格一律快速失败,memo 保证 O(1)
      memo.set(key, UNEVALUATED_OUTCOME)
      return UNEVALUATED_OUTCOME
    }

    if (visiting.has(key)) {
      // 重入 = 环:标记当前活跃调用栈中构成环的所有帧,自身不 memo(由拥有该帧的调用方收尾)
      markCycle(key)
      return UNEVALUATED_OUTCOME
    }

    if (visiting.size >= MAX_DEPTH) {
      const outcome = UNEVALUATED_OUTCOME
      memo.set(key, outcome)
      return outcome
    }

    visiting.add(key)
    let outcome: EvalOutcome
    try {
      const parser = new FormulaParser({
        // 补齐库内被注册成空壳的高频聚合函数(MAX/MIN/MEDIAN/... 见 formulaFunctions.ts)
        functions: CUSTOM_FORMULA_FUNCTIONS,
        onCell: (ref: ParserCellRef) => {
          return ctx.getCellValue({ sheet: ref.sheet, row: ref.row, col: ref.col })
        },
        onRange: (ref: ParserRangeRef) => {
          const rows: unknown[][] = []
          for (let row = ref.from.row; row <= ref.to.row; row++) {
            const cols: unknown[] = []
            for (let col = ref.from.col; col <= ref.to.col; col++) {
              cols.push(ctx.getCellValue({ sheet: ref.sheet, row, col }))
            }
            rows.push(cols)
          }
          return rows
        }
      })
      const result = parser.parse(formula, { sheet: pos.sheet, row: pos.row, col: pos.col })
      outcome = classifyParseResult(result)
    } catch {
      // 解析异常、未知函数(库内部包装为 #ERROR! 抛出)、回调抛出的任何异常:一律 unevaluated,
      // 绝不让一个怪公式的异常逃逸出本模块。
      outcome = UNEVALUATED_OUTCOME
    } finally {
      visiting.delete(key)
    }

    if (cyclicKeys.has(key)) {
      outcome = UNEVALUATED_OUTCOME
      cyclicKeys.delete(key)
    }

    memo.set(key, outcome)
    return outcome
  }

  return { evaluate }
}
