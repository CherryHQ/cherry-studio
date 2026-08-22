import { REGRESSION_CASES, SUITE_IDS } from '../cases'

describe('regression test manifest', () => {
  it('contains every required critical path exactly once', () => {
    expect(REGRESSION_CASES.map(({ id }) => id)).toEqual([
      'S-01',
      'M-01',
      'M-02',
      'C-01',
      'C-02',
      'C-03',
      'K-01',
      'K-02',
      'MCP-01',
      'A-01',
      'A-02',
      'A-03',
      'A-04',
      'A-05',
      'P-01',
      'P-02',
      'T-01',
      'T-02',
      'APP-01',
      'CODE-01',
      'CODE-02',
      'CODE-03',
      'N-01'
    ])
  })

  it('keeps the agreed six sequential suites', () => {
    expect(SUITE_IDS).toEqual(['suite-1', 'suite-2', 'suite-3', 'suite-4', 'suite-5', 'suite-6'])
    expect(
      SUITE_IDS.map((suiteId) => REGRESSION_CASES.filter(({ suite }) => suite === suiteId).map(({ id }) => id))
    ).toEqual([
      ['S-01'],
      ['M-01', 'M-02', 'C-01', 'C-02', 'C-03'],
      ['K-01', 'K-02', 'MCP-01'],
      ['A-01', 'A-02', 'A-03', 'A-04', 'A-05'],
      ['P-01', 'P-02', 'T-01', 'T-02'],
      ['APP-01', 'CODE-01', 'CODE-02', 'CODE-03', 'N-01']
    ])
  })

  it('requires machine evidence with unique ids for every path', () => {
    for (const testCase of REGRESSION_CASES) {
      expect(testCase.steps.length, testCase.id).toBeGreaterThan(0)
      expect(testCase.acceptance.length, testCase.id).toBeGreaterThan(0)
      expect(testCase.evidence.length, testCase.id).toBeGreaterThan(0)
      expect(new Set(testCase.evidence.map(({ id }) => id)).size, testCase.id).toBe(testCase.evidence.length)
      expect(
        testCase.evidence.some(({ kind }) => kind === 'screenshot'),
        testCase.id
      ).toBe(true)
    }
  })

  it('runs only the startup smoke test in suite 1 for both modes', () => {
    const startup = REGRESSION_CASES.find(({ id }) => id === 'S-01')
    expect(startup?.modes).toEqual(['branch', 'tag'])
    expect(startup?.evidence.map(({ id }) => id)).toEqual(['startup-content', 'startup-screen'])
    expect(REGRESSION_CASES.filter(({ modes }) => modes.includes('branch'))).toHaveLength(23)
    expect(REGRESSION_CASES.every(({ modes }) => modes.includes('tag'))).toBe(true)
  })

  it('verifies the external selection fixture as a retained file', () => {
    const selectionCase = REGRESSION_CASES.find(({ id }) => id === 'C-03')

    expect(selectionCase?.evidence.find(({ id }) => id === 'selection-source-preserved')?.kind).toBe('file')
  })
})
