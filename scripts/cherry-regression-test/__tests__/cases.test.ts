import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { REGRESSION_CASES } from '../cases'
import { TASK_IDS, TASK_SELECTIONS } from '../types'

const CASE_IDS = [
  'S-01',
  'APP-01',
  'N-01',
  'M-02',
  'C-01',
  'T-01',
  'T-02',
  'C-02',
  'C-03',
  'K-01',
  'K-02',
  'MCP-01',
  'A-02',
  'CODE-01',
  'CODE-02',
  'CODE-03',
  'M-01',
  'P-01',
  'A-03',
  'A-04',
  'A-05',
  'A-01'
]

const TEST_FILES = [
  '01-startup.test.ts',
  '02-basic-features.test.ts',
  '03-models-and-assistants.test.ts',
  '04-translation.test.ts',
  '05-desktop-assistants.test.ts',
  '06-knowledge.test.ts',
  '07-integrations.test.ts',
  '08-code-tools.test.ts',
  '09-cherryin-and-images.test.ts',
  '10-agent-runtimes.test.ts'
]

describe('regression test manifest', () => {
  it('orders every required path from quick feedback to complex tasks', () => {
    expect(REGRESSION_CASES.map(({ id }) => id)).toEqual(CASE_IDS)
  })

  it('keeps the agreed twenty independently selectable tasks', () => {
    expect(TASK_IDS).toHaveLength(20)
    expect(
      TASK_IDS.map((task) => REGRESSION_CASES.filter((testCase) => testCase.task === task).map(({ id }) => id))
    ).toEqual([
      ['S-01'],
      ['APP-01'],
      ['N-01'],
      ['M-02'],
      ['C-01'],
      ['T-01', 'T-02'],
      ['C-02'],
      ['C-03'],
      ['K-01'],
      ['K-02'],
      ['MCP-01'],
      ['A-02'],
      ['CODE-01', 'CODE-02'],
      ['CODE-03'],
      ['M-01'],
      ['P-01'],
      ['A-03'],
      ['A-04'],
      ['A-05'],
      ['A-01']
    ])
  })

  it('uses one shared authenticated profile for every case', () => {
    expect(REGRESSION_CASES.every(({ modes, profile }) => profile === 'authenticated' && modes.length === 2)).toBe(true)
  })

  it('maps every manifest case to one Playwright title', () => {
    const testDirectory = resolve('tests/e2e/cherry-regression')
    const testFiles = readdirSync(testDirectory)
      .filter((fileName) => fileName.endsWith('.test.ts'))
      .sort()
    const source = testFiles.map((fileName) => readFileSync(resolve(testDirectory, fileName), 'utf8')).join('\n')
    const definitions = [...source.matchAll(/test\('\[([^\]]+)] (.+) @([a-z0-9-]+)'/g)].map((match) => ({
      id: match[1],
      task: match[3],
      title: match[2]
    }))

    expect(testFiles).toEqual(TEST_FILES)
    expect(definitions).toEqual(REGRESSION_CASES.map(({ id, task, title }) => ({ id, task, title })))
  })

  it('maps every task to one of the ten workflow phases', () => {
    const workflow = readFileSync(resolve('.github/workflows/cherry-regression-test.yml'), 'utf8')
    const selectedTasks = [...workflow.matchAll(/needs\.resolve\.outputs\.task == '([a-z0-9-]+)'/g)]
      .map((match) => match[1])
      .filter((task) => task !== 'all')
    const taskInput = workflow.slice(workflow.indexOf('      task:'), workflow.indexOf('\npermissions:'))
    const taskOptions = [...taskInput.matchAll(/^\s{10}- ([a-z0-9-]+)$/gm)].map((match) => match[1])
    const phases = workflow.slice(
      workflow.indexOf('      - name: Phase 01'),
      workflow.indexOf('      - name: Generate platform report')
    )

    expect([...selectedTasks].sort()).toEqual([...TASK_IDS].sort())
    expect(taskOptions).toEqual(TASK_SELECTIONS)
    expect(workflow).toContain('max-parallel: 1')
    expect(phases.match(/continue-on-error: true/g)).toHaveLength(10)
    expect(phases.match(/pnpm test:e2e:regression/g)).toHaveLength(10)
    expect(workflow).not.toContain('run-agent-task')
    expect(workflow).not.toContain('agent-preflight')
  })
})
