import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { REGRESSION_CASES } from '../cases'
import { TASK_IDS, TASK_SELECTIONS } from '../types'

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

  it('keeps the agreed twenty sequential tasks', () => {
    expect(TASK_IDS).toHaveLength(20)
    expect(
      TASK_IDS.map((taskId) => REGRESSION_CASES.filter(({ task }) => task === taskId).map(({ id }) => id))
    ).toEqual([
      ['S-01'],
      ['APP-01'],
      ['N-01'],
      ['M-02'],
      ['C-01'],
      ['C-02'],
      ['C-03'],
      ['T-01', 'T-02'],
      ['K-01'],
      ['K-02'],
      ['MCP-01'],
      ['A-02'],
      ['CODE-01', 'CODE-02'],
      ['CODE-03'],
      ['M-01'],
      ['A-04'],
      ['A-05'],
      ['A-03'],
      ['P-01', 'P-02'],
      ['A-01']
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

  it('runs only the startup smoke test in the startup task for both modes', () => {
    const startup = REGRESSION_CASES.find(({ id }) => id === 'S-01')
    expect(startup?.modes).toEqual(['branch', 'tag'])
    expect(startup?.evidence.map(({ id }) => id)).toEqual(['startup-content', 'startup-screen'])
    expect(REGRESSION_CASES.filter(({ modes }) => modes.includes('branch'))).toHaveLength(23)
    expect(REGRESSION_CASES.every(({ modes }) => modes.includes('tag'))).toBe(true)
  })

  it('switches from the clean startup profile to the shared authenticated profile only once', () => {
    expect(REGRESSION_CASES[0].profile).toBe('clean')
    expect(REGRESSION_CASES.slice(1).every(({ profile }) => profile === 'authenticated')).toBe(true)
  })

  it('restarts before CherryIN and uses the chat response as custom-provider connection proof', () => {
    expect(REGRESSION_CASES.find(({ id }) => id === 'M-01')?.restartBefore).toBe(true)
    expect(REGRESSION_CASES.find(({ id }) => id === 'M-02')?.evidence.map(({ id }) => id)).not.toContain(
      'custom-provider-connection'
    )
  })

  it('schedules every task exactly once in workflow order', () => {
    const workflow = readFileSync(resolve('.github/workflows/cherry-regression-test.yml'), 'utf8')
    const scheduledTasks = [...workflow.matchAll(/^\s+REGRESSION_TASK: ([a-z0-9-]+)$/gm)].map((match) => match[1])
    const selectedTasks = [...workflow.matchAll(/\|\| needs\.resolve\.outputs\.task == '([a-z0-9-]+)'\)/g)].map(
      (match) => match[1]
    )
    const taskInput = workflow.slice(workflow.indexOf('      task:'), workflow.indexOf('\npermissions:'))
    const taskOptions = [...taskInput.matchAll(/^\s{10}- ([a-z0-9-]+)$/gm)].map((match) => match[1])

    expect(scheduledTasks).toEqual(TASK_IDS)
    expect(selectedTasks).toEqual(TASK_IDS)
    expect(taskOptions).toEqual(TASK_SELECTIONS)
    expect(workflow).toContain('max-parallel: 1')
    expect(workflow.match(/continue-on-error: true/g)).toHaveLength(1)
    expect(workflow).toContain('--task "$TEST_TASK"')
  })

  it('verifies the external selection fixture as a retained file', () => {
    const selectionCase = REGRESSION_CASES.find(({ id }) => id === 'C-03')

    expect(selectionCase?.evidence.find(({ id }) => id === 'selection-source-preserved')?.kind).toBe('file')
  })

  it('verifies Code CLI working directories from owned process commands', () => {
    for (const caseId of ['CODE-01', 'CODE-02']) {
      const codeCase = REGRESSION_CASES.find(({ id }) => id === caseId)
      expect(codeCase?.evidence.find(({ id }) => id.endsWith('-directory'))?.kind).toBe('process')
    }
  })
})
