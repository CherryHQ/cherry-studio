import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse } from 'yaml'

const WORKFLOW = '.github/workflows/e2e-regression-test.yml'
// The claiming client (qa_release_e2e.py) matches a run whose title ends with "[op:<id>]".
// This literal is the contract: change it only together with that client.
const RUN_NAME =
  "${{ github.event_name == 'workflow_dispatch' && format('E2E Regression · {0} · {1}{2}', inputs.ref, inputs.task, inputs.op_id != '' && format(' [op:{0}]', inputs.op_id) || '') || format('E2E Regression (scheduled) {0}', github.sha) }}"

type Step = { name?: string; if?: string; env?: Record<string, string>; run?: string; shell?: string }

function workflow() {
  return parse(readFileSync(resolve(WORKFLOW), 'utf8'))
}

function guard(): Step {
  const step = (workflow().jobs.resolve.steps as Step[]).find(
    (item) => item.name === 'Validate dispatch correlation id'
  )
  expect(step).toBeDefined()
  return step as Step
}

function guardExit(value: string): number | null {
  try {
    execFileSync('bash', ['-c', guard().run as string], { env: { ...process.env, QA_OP_ID: value }, stdio: 'pipe' })
    return 0
  } catch (error) {
    return (error as { status?: number | null }).status ?? null
  }
}

describe('dispatch identity', () => {
  it('accepts an optional correlation id from the dispatcher', () => {
    expect(workflow().on.workflow_dispatch.inputs.op_id).toEqual({
      description: expect.any(String),
      type: 'string',
      default: ''
    })
  })

  it('echoes the correlation id as a trailing marker and keeps scheduled runs labelled', () => {
    expect(workflow()['run-name']).toBe(RUN_NAME)
  })

  it('validates the whole id before any checkout or application work', () => {
    const step = guard()
    expect(step.if).toBe("github.event_name == 'workflow_dispatch' && inputs.op_id != ''")
    // `[[ ... =~ ... ]]` needs bash; a silent switch to sh would change how the pattern is read.
    expect(step.shell).toBe('bash')
    expect(step.env?.QA_OP_ID).toBe('${{ inputs.op_id }}')
    // The id must reach the shell through env only; interpolation into the script would allow injection.
    expect(step.run).not.toContain('${{')
    const first = (workflow().jobs.resolve.steps as Step[])[0]
    expect(first.name).toBe('Validate dispatch correlation id')
    for (const good of ['0123456789abcdef', 'ffffffffffffffff']) expect(guardExit(good)).toBe(0)
    for (const bad of [
      '',
      '0123456789ABCDEF',
      '0123456789abcde',
      '0123456789abcdef0',
      '0123456789abcdef\n',
      '0123456789abcdef\r',
      '0123456789abcdef\r\n',
      '0123456789abcdef\njunk',
      'zz'
    ]) {
      expect(guardExit(bad)).not.toBe(0)
    }
  })
})
