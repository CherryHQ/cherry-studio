import { describe, expect, it } from 'vitest'

import {
  createFormulaEvaluator,
  type EvalContext,
  type FormulaCellRef,
  type FormulaEvaluator
} from '../worker/formulaEvaluator'

type StubCellValue = string | number | boolean | null
interface StubCell {
  /** 公式原文,不含前导 '='。设置了 formula 的单元格会递归调用 evaluator.evaluate */
  formula?: string
  /** 非公式单元格的原始值 */
  value?: StubCellValue
}
type StubSheet = Record<string, StubCell>

/**
 * 手写 EvalContext stub:模拟解析流水线的行为——公式单元格的 getCellValue
 * 递归调用同一个 evaluator 的 evaluate(),从而天然形成链式/环形递归。
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

/** 便捷构造:创建 evaluator 并完成 stub 的循环绑定 */
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

describe('createFormulaEvaluator — range aggregation with holes', () => {
  it('treats empty cells within a range as 0 for SUM', () => {
    const sheets = {
      Sheet1: {
        '1:1': { value: 1 },
        '2:1': { value: 2 },
        // 3:1 空
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

    // B1 的公式应当只被真正求值一次(memo 命中),对应 A1 只被读取一次
    expect(callCount({ sheet: 'Sheet1', row: 1, col: 1 })).toBe(1)

    // 再次直接对 B1 求值应命中 memo,不再重新读取 A1
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
    // D1 = A1 + E1, A1 = B1, B1 = A1 (A1/B1 互为环), E1 = 5 常量
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
    // A1 参与环 → 对 D1 而言取到 null(按 0 参与运算),D1 本身不在环上,应正常给出数值结果
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

describe('createFormulaEvaluator — recursion depth guard', () => {
  it('does not stack-overflow or hang on an extremely deep non-cyclic reference chain', () => {
    // 深度 200 远超建议上限 64:验证深度守卫生效,整体求值在有限时间内正常返回
    // (不断言链顶端的具体数值——深链中段一旦触发深度上限被判 unevaluated 并按 0 参与运算,
    // 链顶端会据此算出一个"降级但良定义"的数字,这是预期的优雅降级而非 bug)。
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
