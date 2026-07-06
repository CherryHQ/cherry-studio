/**
 * Best-effort formula evaluation, levels 2/3 in the fallback strategy. Callers invoke evaluate only after no cached
 * value is available. Covers error classification, cycle detection, memoization, and budget control.
 *
 * Observed fast-formula-parser behavior, confirmed directly with Node where it differs from its docs:
 * - `parser.parse()` returns a FormulaError instance, rather than throwing, for legitimate Excel error results:
 *   #DIV/0!, #VALUE!, #N/A, #NUM!, #NULL!, #REF!, and unknown named ranges used as bare identifiers (#NAME?).
 * - Unknown function calls such as `FOOBAR(1)`, syntax/lexical errors, and any exception thrown by onCell/onRange
 *   callbacks are wrapped as FormulaError('#ERROR!', ...) and thrown instead of returning #NAME?.
 *   Therefore unknown function -> unevaluated is covered by the fallback rule that any parse() throw is unevaluated;
 *   it does not depend on the thrown object's error code.
 * - The boundary between throwing and legitimate returned error codes matches the semantics in doc 03 section 2.
 *   #NAME? may come from either a returned value or a wrapped throw in the library; both are classified as
 *   unevaluated here, matching the documented result.
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
  /** Returns the raw cell value. Formula cells return their evaluated result and trigger recursive evaluation. */
  getCellValue(ref: FormulaCellRef): string | number | boolean | null
}

export interface EvalOutcome {
  state: 'evaluated' | 'unevaluated'
  /** Present when evaluated. Legal error results such as #DIV/0! are represented as strings. */
  value?: string | number | boolean | null
}

export interface FormulaEvaluator {
  evaluate(formula: string, pos: FormulaCellRef): EvalOutcome
}

/** Recursion depth limit to prevent deep formula chains from overflowing the stack. */
const MAX_DEPTH = 64

/** onRange materialization limit in cells. Ranges above this are abandoned to protect the worker. */
const MAX_RANGE_CELLS = 100_000

/** In-loop deadline check interval for onRange, in cells. */
const RANGE_DEADLINE_CHECK_INTERVAL = 1024

/** Legitimate Excel error codes returned by parse() that mean unsupported/unresolvable, not a valid result. */
const UNEVALUATED_ERROR_CODES = new Set(['#NAME?'])

const UNEVALUATED_OUTCOME: EvalOutcome = { state: 'unevaluated' }

function makeKey(ref: FormulaCellRef): string {
  return `${ref.sheet}!${ref.row}:${ref.col}`
}

/** Raw parse() result -> cell scalar value in EvalOutcome.value's range. */
function normalizeValue(result: unknown): string | number | boolean | null {
  if (result === null || result === undefined) return null
  if (typeof result === 'number' || typeof result === 'string' || typeof result === 'boolean') {
    return result
  }
  // The parser should already normalize arrays/ranges/unions into scalars or FormulaError.
  // Reaching this branch means an unexpected shape; conservatively treat it as unevaluable through caller fallback.
  return null
}

export function createFormulaEvaluator(ctx: EvalContext, budgetMs: number): FormulaEvaluator {
  const deadline = Date.now() + budgetMs

  /** Completed cell evaluation cache, keyed as "sheet!row:col". */
  const memo = new Map<string, EvalOutcome>()
  /** Cells currently being evaluated on the call stack, used for cycle detection. */
  const visiting = new Set<string>()
  /** Keys detected as part of a cycle in this round. Forced to unevaluated when their owning frame exits. */
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
      // Budget exhausted: all later unevaluated cells fail fast, with memoization keeping it O(1).
      memo.set(key, UNEVALUATED_OUTCOME)
      return UNEVALUATED_OUTCOME
    }

    if (visiting.has(key)) {
      // Re-entry means a cycle. Mark active stack frames in the cycle; the owning callers finalize memo entries.
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
        // Fill high-frequency aggregate functions that the library registers as empty stubs; see formulaFunctions.ts.
        functions: CUSTOM_FORMULA_FUNCTIONS,
        onCell: (ref: ParserCellRef) => {
          return ctx.getCellValue({ sheet: ref.sheet, row: ref.row, col: ref.col })
        },
        onRange: (ref: ParserRangeRef) => {
          // Throw on area limit or timeout. The outer catch converts to unevaluated and never materializes huge ranges.
          const rangeRows = ref.to.row - ref.from.row + 1
          const rangeCols = ref.to.col - ref.from.col + 1
          if (rangeRows * rangeCols > MAX_RANGE_CELLS) {
            throw new Error(`range exceeds ${MAX_RANGE_CELLS} cells`)
          }
          let visited = 0
          const rows: unknown[][] = []
          for (let row = ref.from.row; row <= ref.to.row; row++) {
            const cols: unknown[] = []
            for (let col = ref.from.col; col <= ref.to.col; col++) {
              if (++visited % RANGE_DEADLINE_CHECK_INTERVAL === 0 && Date.now() >= deadline) {
                throw new Error('formula budget exhausted while reading range')
              }
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
      // Parse errors, unknown functions wrapped as thrown #ERROR!, and callback exceptions all become unevaluated.
      // A strange formula must never let an exception escape this module.
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
