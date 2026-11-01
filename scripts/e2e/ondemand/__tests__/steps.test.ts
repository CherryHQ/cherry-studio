import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { parsePlan } from '../plan'
import { completeResult, createResult } from '../report'
import { createScenarioContext, executePlan } from '../steps'

function inputPage() {
  const values: Record<string, string> = {}
  let connected = true
  const page = {
    locator: (selector: string) => ({
      fill: async (text: string) => {
        if (selector === '#missing') throw new Error('Input was not found')
        if (selector === '#crash') {
          connected = false
          throw new Error('Connection closed')
        }
        values[selector] = text
      }
    }),
    isClosed: () => !connected,
    context: () => ({ browser: () => ({ isConnected: () => connected }) }),
    getByText: () => ({}),
    screenshot: async () => Buffer.from('masked screenshot')
  } as unknown as Page
  return { values, page }
}

// Catch execution continuing after a fail-fast error, or a continued failure becoming green.
it.each([false, true])('retains failed outcomes with continueOnFailure=%s', async (continueOnFailure) => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-steps-'))
  mkdirSync(join(directory, 'screenshots'))
  try {
    const { values, page } = inputPage()
    const result = createResult({})
    const context = createScenarioContext(
      page,
      result,
      directory,
      [],
      () => {},
      async () => {}
    )
    await executePlan(
      context,
      parsePlan(
        JSON.stringify({
          continueOnFailure,
          steps: [
            { verb: 'fill', selector: '#before', text: 'before' },
            { verb: 'fill', selector: '#missing', text: 'missing' },
            { verb: 'fill', selector: '#after', text: 'after' }
          ]
        })
      )
    )
    completeResult(result)
    expect(values).toEqual(continueOnFailure ? { '#before': 'before', '#after': 'after' } : { '#before': 'before' })
    expect(result.steps.map((step) => step.status)).toEqual([
      'passed',
      'failed',
      continueOnFailure ? 'passed' : 'not_run'
    ])
    expect(result).toMatchObject({ status: 'failed', exitCode: 1 })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('stops even continue-on-failure plans when the application connection is lost', async () => {
  const { values, page } = inputPage()
  const result = createResult({})
  const directory = mkdtempSync(join(tmpdir(), 'qa-crash-'))
  try {
    const context = createScenarioContext(
      page,
      result,
      directory,
      [],
      () => {},
      async () => {}
    )
    await executePlan(
      context,
      parsePlan(
        '{"continueOnFailure":true,"steps":[{"verb":"fill","selector":"#crash","text":"x"},{"verb":"fill","selector":"#after","text":"x"}]}'
      )
    )
    completeResult(result)
    expect(values).toEqual({})
    expect(result.steps.map((step) => step.status)).toEqual(['failed', 'not_run'])
    expect(result.exitCode).toBe(3)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it.each(['capture', 'write'])('stops and retains a report failure after a screenshot %s error', async (failure) => {
  const { values, page } = inputPage()
  const result = createResult({})
  const directory = mkdtempSync(join(tmpdir(), 'qa-screenshot-'))
  if (failure === 'capture') {
    mkdirSync(join(directory, 'screenshots'))
    vi.spyOn(page, 'screenshot').mockRejectedValueOnce(new Error('Screenshot capture failed'))
  }
  try {
    const context = createScenarioContext(
      page,
      result,
      directory,
      [],
      () => {},
      async () => {}
    )
    await executePlan(
      context,
      parsePlan(
        '{"continueOnFailure":true,"steps":[{"verb":"screenshot"},{"verb":"fill","selector":"#after","text":"x"}]}'
      )
    )
    mkdirSync(join(directory, 'screenshots'), { recursive: true })
    await context.screenshot('final')
    completeResult(result)
    expect(values).toEqual({})
    expect(result.steps.map((step) => step.status)).toEqual(['failed', 'not_run'])
    expect(result).toMatchObject({
      status: 'failed',
      exitCode: 2,
      failureStage: 'report',
      errors: [{ stage: 'report', exitCode: 2, code: 'SCREENSHOT_FAILED' }]
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
