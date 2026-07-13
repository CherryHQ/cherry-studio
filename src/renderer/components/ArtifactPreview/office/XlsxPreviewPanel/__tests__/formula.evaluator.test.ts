import type { FunctionArg } from 'fast-formula-parser'
import { describe, expect, it, vi } from 'vitest'

import {
  createFormulaEvaluator,
  type EvalContext,
  type FormulaCellRef,
  type FormulaEvaluator
} from '../worker/formulaEvaluator'
import { CUSTOM_FORMULA_FUNCTIONS } from '../worker/formulaFunctions'

type StubCellValue = string | number | boolean | null
interface StubCell {
  /** Raw formula without the leading '='. Cells with formula recursively call evaluator.evaluate. */
  formula?: string
  /** Raw value for non-formula cells. */
  value?: StubCellValue
}
type StubSheet = Record<string, StubCell>

/**
 * Handwritten EvalContext stub that mirrors the parsing pipeline: getCellValue for formula cells
 * recursively calls evaluate() on the same evaluator, naturally creating chained or cyclic recursion.
 */
function makeStubContext(sheets: Record<string, StubSheet>): {
  ctx: EvalContext
  bind: (evaluator: FormulaEvaluator) => void
  callCount: (ref: FormulaCellRef) => number
} {
  const held: { evaluator?: FormulaEvaluator } = {}
  const callCounts = new Map<string, number>()

  const ctx: EvalContext = {
    getCellValue(ref: FormulaCellRef): StubCellValue {
      const fullKey = `${ref.sheet}!${ref.row}:${ref.col}`
      callCounts.set(fullKey, (callCounts.get(fullKey) ?? 0) + 1)

      const cell = sheets[ref.sheet]?.[`${ref.row}:${ref.col}`]
      if (!cell) return null
      if (cell.formula !== undefined) {
        const outcome = held.evaluator!.evaluate(cell.formula, ref)
        return outcome.state === 'evaluated' ? (outcome.value ?? null) : null
      }
      return cell.value ?? null
    }
  }

  return {
    ctx,
    bind: (evaluator) => {
      held.evaluator = evaluator
    },
    callCount: (ref) => callCounts.get(`${ref.sheet}!${ref.row}:${ref.col}`) ?? 0
  }
}

/** Convenience setup that creates an evaluator and completes the stub's circular binding. */
function setup(sheets: Record<string, StubSheet>, budgetMs = 5000) {
  const { ctx, bind, callCount } = makeStubContext(sheets)
  const evaluator = createFormulaEvaluator(ctx, budgetMs)
  bind(evaluator)
  return { evaluator, callCount }
}

const POS: FormulaCellRef = { sheet: 'Sheet1', row: 1, col: 1 }

describe('createFormulaEvaluator — basic operators and functions', () => {
  it('evaluates four arithmetic operators', () => {
    const { evaluator } = setup({})
    expect(evaluator.evaluate('1+2', POS)).toEqual({ state: 'evaluated', value: 3 })
    expect(evaluator.evaluate('5-2', { ...POS, row: 2 })).toEqual({ state: 'evaluated', value: 3 })
    expect(evaluator.evaluate('4*3', { ...POS, row: 3 })).toEqual({ state: 'evaluated', value: 12 })
    expect(evaluator.evaluate('10/4', { ...POS, row: 4 })).toEqual({ state: 'evaluated', value: 2.5 })
  })

  it('evaluates SUM/AVERAGE/IF/COUNT/ROUND/CONCATENATE over cell references', () => {
    const sheets = {
      Sheet1: {
        '1:1': { value: 1 },
        '2:1': { value: 2 },
        '3:1': { value: 3 }
      }
    }
    const { evaluator } = setup(sheets)
    expect(evaluator.evaluate('SUM(A1:A3)', { sheet: 'Sheet1', row: 10, col: 1 })).toEqual({
      state: 'evaluated',
      value: 6
    })
    expect(evaluator.evaluate('AVERAGE(A1:A3)', { sheet: 'Sheet1', row: 10, col: 2 })).toEqual({
      state: 'evaluated',
      value: 2
    })
    expect(evaluator.evaluate('IF(A1>0,"pos","neg")', { sheet: 'Sheet1', row: 10, col: 3 })).toEqual({
      state: 'evaluated',
      value: 'pos'
    })
    expect(evaluator.evaluate('COUNT(A1:A3)', { sheet: 'Sheet1', row: 10, col: 4 })).toEqual({
      state: 'evaluated',
      value: 3
    })
    expect(evaluator.evaluate('ROUND(1.2345,2)', { sheet: 'Sheet1', row: 10, col: 5 })).toEqual({
      state: 'evaluated',
      value: 1.23
    })
    expect(evaluator.evaluate('CONCATENATE("a","b")', { sheet: 'Sheet1', row: 10, col: 6 })).toEqual({
      state: 'evaluated',
      value: 'ab'
    })
  })

  it('evaluates IF with equality comparisons and arithmetic branches', () => {
    const sheets = {
      Sheet1: {
        '4:14': { value: 0 },
        '5:14': { value: 2 },
        '6:14': { value: 10 },
        '7:14': { value: 10 }
      }
    }
    const { evaluator } = setup(sheets)

    expect(evaluator.evaluate('IF(N4=0,"-",N6/N4)', { sheet: 'Sheet1', row: 6, col: 15 })).toEqual({
      state: 'evaluated',
      value: '-'
    })
    expect(evaluator.evaluate('IF(N5=0,"-",N7/N5)', { sheet: 'Sheet1', row: 7, col: 15 })).toEqual({
      state: 'evaluated',
      value: 5
    })
  })

  it('evaluates VLOOKUP against a stub table', () => {
    const sheets = {
      Sheet1: {
        '1:1': { value: 1 },
        '1:2': { value: 'one' },
        '2:1': { value: 2 },
        '2:2': { value: 'two' },
        '3:1': { value: 3 },
        '3:2': { value: 'three' }
      }
    }
    const { evaluator } = setup(sheets)
    expect(evaluator.evaluate('VLOOKUP(2,A1:B3,2,FALSE)', { sheet: 'Sheet1', row: 10, col: 1 })).toEqual({
      state: 'evaluated',
      value: 'two'
    })
  })

  it('resolves cross-sheet references', () => {
    const sheets = {
      Sheet1: { '1:1': { value: 10 } },
      Sheet2: {}
    }
    const { evaluator } = setup(sheets)
    const outcome = evaluator.evaluate('Sheet1!A1*2', { sheet: 'Sheet2', row: 1, col: 1 })
    expect(outcome).toEqual({ state: 'evaluated', value: 20 })
  })
})

describe('createFormulaEvaluator — custom aggregate functions (library stubs)', () => {
  // MAX/MIN/MEDIAN/... are registered as empty stubs in the library and are filled by formulaFunctions.ts.
  // The data layout matches the screenshot: column C (col 3), row 2 is a text header, rows 3-8 are numbers.
  const statSheet = {
    Sheet1: {
      '2:3': { value: '上海最高温度(℃)' },
      '3:3': { value: 33 },
      '4:3': { value: 35 },
      '5:3': { value: 37 },
      '6:3': { value: 34 },
      '7:3': { value: 36 },
      '8:3': { value: 38 }
    }
  }
  const at = (row: number) => ({ sheet: 'Sheet1', row, col: 6 })

  it('MAX/MIN ignore the leading text cell and return the numeric extremum', () => {
    const { evaluator } = setup(statSheet)
    // This is the exact case that used to show "formula not evaluated" for D14=MAX(C2:C8) in the screenshot.
    expect(evaluator.evaluate('MAX(C2:C8)', at(14))).toEqual({ state: 'evaluated', value: 38 })
    expect(evaluator.evaluate('MIN(C2:C8)', at(15))).toEqual({ state: 'evaluated', value: 33 })
  })

  it('evaluates MAX-minus-MIN composite formula', () => {
    const { evaluator } = setup(statSheet)
    expect(evaluator.evaluate('MAX(C2:C8)-MIN(C2:C8)', at(16))).toEqual({ state: 'evaluated', value: 5 })
  })

  it('MEDIAN averages the two middle values for an even count', () => {
    const { evaluator } = setup(statSheet)
    // 33,34,35,36,37,38 -> (35+36)/2
    expect(evaluator.evaluate('MEDIAN(C3:C8)', at(17))).toEqual({ state: 'evaluated', value: 35.5 })
  })

  it('COUNTA counts non-empty cells (including the text header) while COUNT skips it', () => {
    const { evaluator } = setup(statSheet)
    expect(evaluator.evaluate('COUNTA(C2:C8)', at(18))).toEqual({ state: 'evaluated', value: 7 })
    expect(evaluator.evaluate('COUNT(C2:C8)', at(19))).toEqual({ state: 'evaluated', value: 6 })
  })

  it('LARGE/SMALL return the kth ordered numeric value', () => {
    const { evaluator } = setup(statSheet)
    expect(evaluator.evaluate('LARGE(C2:C8,2)', at(20))).toEqual({ state: 'evaluated', value: 37 })
    expect(evaluator.evaluate('SMALL(C2:C8,2)', at(21))).toEqual({ state: 'evaluated', value: 34 })
  })

  it('LARGE with out-of-range k returns #NUM! as an evaluated error', () => {
    const { evaluator } = setup(statSheet)
    expect(evaluator.evaluate('LARGE(C3:C8,99)', at(22))).toEqual({ state: 'evaluated', value: '#NUM!' })
  })

  it('MAX over an all-empty range returns 0', () => {
    const { evaluator } = setup(statSheet)
    expect(evaluator.evaluate('MAX(Z1:Z5)', at(23))).toEqual({ state: 'evaluated', value: 0 })
  })

  it('MAX/MIN scan large combined inputs without spreading them into function arguments', () => {
    const values = Array.from({ length: 200_000 }, (_, index) => index - 100_000)
    const arg: FunctionArg = { value: [values], isArray: true }

    expect(CUSTOM_FORMULA_FUNCTIONS.MAX(arg)).toBe(99_999)
    expect(CUSTOM_FORMULA_FUNCTIONS.MIN(arg)).toBe(-100_000)
  })

  it('evaluates population variance and standard deviation', () => {
    const { evaluator } = setup(statSheet)
    // 33,35,37,34,36,38 mean=35.5, sum((x - mean)^2)=17.5, VAR.P=17.5/6.
    const varP = evaluator.evaluate('VAR.P(C3:C8)', at(24))
    expect(varP.state).toBe('evaluated')
    expect(varP.value).toBeCloseTo(17.5 / 6, 10)
    const stdevP = evaluator.evaluate('STDEV.P(C3:C8)', at(25))
    expect(stdevP.state).toBe('evaluated')
    expect(stdevP.value).toBeCloseTo(Math.sqrt(17.5 / 6), 10)
  })

  it('MODE.SNGL returns #N/A when every value is unique', () => {
    const { evaluator } = setup(statSheet)
    // C3:C8 has no repeated values.
    expect(evaluator.evaluate('MODE.SNGL(C3:C8)', at(26))).toEqual({ state: 'evaluated', value: '#N/A' })
  })
})

describe('createFormulaEvaluator — range aggregation with holes', () => {
  it('treats empty cells within a range as 0 for SUM', () => {
    const sheets = {
      Sheet1: {
        '1:1': { value: 1 },
        '2:1': { value: 2 },
        // 3:1 is empty.
        '4:1': { value: 4 },
        '5:1': { value: 5 }
      }
    }
    const { evaluator } = setup(sheets)
    expect(evaluator.evaluate('SUM(A1:A5)', { sheet: 'Sheet1', row: 10, col: 1 })).toEqual({
      state: 'evaluated',
      value: 12
    })
  })
})

describe('createFormulaEvaluator — chained dependency and memoization', () => {
  it('recursively evaluates a dependency chain and memoizes intermediate results', () => {
    const sheets = {
      Sheet1: {
        '1:1': { value: 1 }, // A1 = 1
        '1:2': { formula: 'A1+1' }, // B1 = A1 + 1
        '1:3': { formula: 'B1*2' } // C1 = B1 * 2
      }
    }
    const { evaluator, callCount } = setup(sheets)

    const outcome = evaluator.evaluate('B1*2', { sheet: 'Sheet1', row: 1, col: 3 })
    expect(outcome).toEqual({ state: 'evaluated', value: 4 })

    // B1 should be evaluated only once because memoization hits, so A1 is read only once.
    expect(callCount({ sheet: 'Sheet1', row: 1, col: 1 })).toBe(1)

    // Evaluating B1 directly again should hit the memo and avoid rereading A1.
    const b1Outcome = evaluator.evaluate('A1+1', { sheet: 'Sheet1', row: 1, col: 2 })
    expect(b1Outcome).toEqual({ state: 'evaluated', value: 2 })
    expect(callCount({ sheet: 'Sheet1', row: 1, col: 1 })).toBe(1)
  })
})

describe('createFormulaEvaluator — circular references', () => {
  it('marks both cells in a two-cell cycle as unevaluated without hanging', () => {
    const sheets = {
      Sheet1: {
        '1:1': { formula: 'B1' }, // A1 = B1
        '1:2': { formula: 'A1' } // B1 = A1
      }
    }
    const { evaluator } = setup(sheets)

    const a1 = evaluator.evaluate('B1', { sheet: 'Sheet1', row: 1, col: 1 })
    expect(a1).toEqual({ state: 'unevaluated' })

    const b1 = evaluator.evaluate('A1', { sheet: 'Sheet1', row: 1, col: 2 })
    expect(b1).toEqual({ state: 'unevaluated' })
  })

  it('does not poison an unrelated ancestor that merely reads a cyclic cell', () => {
    // D1 = A1 + E1, A1 = B1, B1 = A1 (A1/B1 form a cycle), E1 = constant 5.
    const sheets = {
      Sheet1: {
        '1:1': { formula: 'B1' }, // A1
        '1:2': { formula: 'A1' }, // B1
        '1:5': { value: 5 }, // E1
        '1:4': { formula: 'A1+E1' } // D1
      }
    }
    const { evaluator } = setup(sheets)

    const d1 = evaluator.evaluate('A1+E1', { sheet: 'Sheet1', row: 1, col: 4 })
    // A1 is cyclic, so D1 reads it as null (0 in arithmetic). D1 itself is not cyclic and should evaluate.
    expect(d1).toEqual({ state: 'evaluated', value: 5 })
  })
})

describe('createFormulaEvaluator — result classification (contract §2 table)', () => {
  it('classifies a normal return as evaluated', () => {
    const { evaluator } = setup({})
    expect(evaluator.evaluate('1+1', POS)).toEqual({ state: 'evaluated', value: 2 })
  })

  it.each([
    ['1/0', '#DIV/0!'],
    ['1+"a"', '#VALUE!'],
    ['NA()', '#N/A'],
    ['SQRT(-1)', '#NUM!'],
    ['#NULL!', '#NULL!'],
    ['A1:B1 A2:B2', '#NULL!']
  ])('treats legitimately returned error code from %s as evaluated(%s)', (formula, code) => {
    const { evaluator } = setup({})
    const outcome = evaluator.evaluate(formula, POS)
    expect(outcome.state).toBe('evaluated')
    expect(outcome.value).toBe(code)
  })

  it('classifies #REF! (e.g. VLOOKUP out-of-range column) as evaluated', () => {
    const sheets = {
      Sheet1: {
        '1:1': { value: 1 },
        '1:2': { value: 'one' }
      }
    }
    const { evaluator } = setup(sheets)
    const outcome = evaluator.evaluate('VLOOKUP(1,A1:B1,5)', { sheet: 'Sheet1', row: 10, col: 1 })
    expect(outcome).toEqual({ state: 'evaluated', value: '#REF!' })
  })

  it('classifies #NAME? (undefined name/range) as unevaluated', () => {
    const { evaluator } = setup({})
    const outcome = evaluator.evaluate('SOME_UNDEFINED_NAME', POS)
    expect(outcome).toEqual({ state: 'unevaluated' })
  })

  it('classifies an unknown function call as unevaluated', () => {
    const { evaluator } = setup({})
    expect(evaluator.evaluate('FOOBAR(1)', POS)).toEqual({ state: 'unevaluated' })
  })

  it('classifies a parse/syntax error as unevaluated', () => {
    const { evaluator } = setup({})
    expect(evaluator.evaluate('1+', POS)).toEqual({ state: 'unevaluated' })
  })
})

describe('createFormulaEvaluator — unknown functions', () => {
  it('returns unevaluated for an unrecognized function name', () => {
    const { evaluator } = setup({})
    expect(evaluator.evaluate('FOOBAR(1)', POS)).toEqual({ state: 'unevaluated' })
  })
})

describe('createFormulaEvaluator — budget', () => {
  it('with budgetMs=0, immediately returns unevaluated for everything', () => {
    const sheets = { Sheet1: { '1:1': { value: 1 } } }
    const { evaluator } = setup(sheets, 0)
    const start = Date.now()
    expect(evaluator.evaluate('1+1', POS)).toEqual({ state: 'unevaluated' })
    expect(evaluator.evaluate('SUM(A1:A1)', { ...POS, row: 2 })).toEqual({ state: 'unevaluated' })
    expect(Date.now() - start).toBeLessThan(50)
  })
})

describe('createFormulaEvaluator — malformed / adversarial input', () => {
  it('does not throw on unbalanced parentheses', () => {
    const { evaluator } = setup({})
    expect(() => evaluator.evaluate('((((', POS)).not.toThrow()
    expect(evaluator.evaluate('((((', POS)).toEqual({ state: 'unevaluated' })
  })

  it('does not throw on an extremely long garbage string', () => {
    const { evaluator } = setup({})
    const garbage = `${'A1+'.repeat(5000)}1`
    expect(() => evaluator.evaluate(garbage, POS)).not.toThrow()
  })

  it('does not throw when the formula string is empty', () => {
    const { evaluator } = setup({})
    expect(() => evaluator.evaluate('', POS)).not.toThrow()
    expect(evaluator.evaluate('', POS)).toEqual({ state: 'unevaluated' })
  })

  it('does not let an exception thrown by getCellValue escape', () => {
    const ctx: EvalContext = {
      getCellValue() {
        throw new Error('boom')
      }
    }
    const evaluator = createFormulaEvaluator(ctx, 5000)
    expect(() => evaluator.evaluate('A1+1', POS)).not.toThrow()
    expect(evaluator.evaluate('A1+1', POS)).toEqual({ state: 'unevaluated' })
  })
})

describe('createFormulaEvaluator — oversized range guard', () => {
  it('returns unevaluated for a whole-sheet range without materializing any cell', () => {
    const { evaluator, callCount } = setup({})
    const start = Date.now()
    // A1:XFD1048576 is about 17.2 billion cells; the area guard must reject it before reading any cell.
    expect(evaluator.evaluate('SUM(A1:XFD1048576)', { sheet: 'Sheet1', row: 1, col: 20000 })).toEqual({
      state: 'unevaluated'
    })
    expect(Date.now() - start).toBeLessThan(1000)
    expect(callCount({ sheet: 'Sheet1', row: 500, col: 5 })).toBe(0)
  })

  it('still evaluates a large-but-bounded range', () => {
    const sheets = {
      Sheet1: {
        '1:1': { value: 2 },
        '5000:1': { value: 3 }
      }
    }
    const { evaluator } = setup(sheets)
    expect(evaluator.evaluate('SUM(A1:A5000)', { sheet: 'Sheet1', row: 1, col: 4 })).toEqual({
      state: 'evaluated',
      value: 5
    })
  })

  it('aborts range materialization when the deadline expires mid-loop', () => {
    // Date.now call order: createFormulaEvaluator sets the deadline, evaluate checks entry, then onRange checks in-loop.
    // The first two calls return 0 (deadline=1000, entry allowed); later calls return 5000 and hit the timeout in-loop.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(5000)
    try {
      const { evaluator, callCount } = setup({}, 1000)
      // 2000 cells is above the 1024 check stride, so the loop performs at least one in-loop check.
      expect(evaluator.evaluate('SUM(A1:B1000)', { sheet: 'Sheet1', row: 1, col: 4 })).toEqual({
        state: 'unevaluated'
      })
      expect(callCount({ sheet: 'Sheet1', row: 999, col: 2 })).toBe(0)
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe('createFormulaEvaluator — recursion depth guard', () => {
  it('does not stack-overflow or hang on an extremely deep non-cyclic reference chain', () => {
    // Depth 200 is far above the suggested limit of 64. Verify the depth guard keeps evaluation bounded.
    // Do not assert the chain head's exact value: once a middle link hits the limit, it becomes unevaluated and
    // contributes 0 to arithmetic, producing a degraded but well-defined value at the top.
    const DEPTH = 200
    const sheets: Record<string, StubSheet> = { Sheet1: { '1:1': { value: 0 } } }
    for (let row = 2; row <= DEPTH; row++) {
      sheets.Sheet1[`${row}:1`] = { formula: `A${row - 1}+1` }
    }
    const { evaluator } = setup(sheets)
    const start = Date.now()
    let outcome: ReturnType<typeof evaluator.evaluate> | undefined
    expect(() => {
      outcome = evaluator.evaluate(`A${DEPTH - 1}+1`, { sheet: 'Sheet1', row: DEPTH, col: 1 })
    }).not.toThrow()
    expect(Date.now() - start).toBeLessThan(1000)
    expect(outcome).toBeDefined()
    expect(['evaluated', 'unevaluated']).toContain(outcome!.state)
    if (outcome!.state === 'evaluated') {
      expect(typeof outcome!.value === 'number' || outcome!.value === null).toBe(true)
    }
  })
})
