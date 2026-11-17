import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, type Page } from '@playwright/test'

import { captureMaskedScreenshot } from '../regression/screenshotEvidence'
import { type Plan, type Step, stepSchema } from './plan'
import { addFailure, QaError, type Result } from './report'

export interface ScenarioContext {
  page: Page
  runSteps: (steps: Step[], options?: { continueOnFailure?: boolean }) => Promise<void>
  screenshot: (name?: string) => Promise<void>
  ensureChinese: () => Promise<void>
}

export function createScenarioContext(
  page: Page,
  result: Result,
  out: string,
  secrets: string[],
  persist: () => void,
  ensureChinese: () => Promise<void>
): ScenarioContext {
  const screenshot = async (name = 'capture') => {
    const safe = stepSchema.parse({ verb: 'screenshot', name })
    if (safe.verb !== 'screenshot') return
    const relative = `screenshots/${result.artifacts.length + 1}-${safe.name}.png`
    writeFileSync(join(out, relative), await captureMaskedScreenshot(page, secrets), { mode: 0o600 })
    result.artifacts.push(relative)
  }
  return {
    page,
    screenshot,
    ensureChinese,
    runSteps: async (steps, options = {}) => {
      let stopped =
        result.errors.some((error) => error.exitCode !== 1) || (result.errors.length > 0 && !options.continueOnFailure)
      for (const input of steps) {
        const step = stepSchema.parse(input)
        const entry = {
          step: result.steps.length + 1,
          verb: step.verb,
          status: 'not_run' as 'not_run' | 'passed' | 'failed',
          seconds: 0,
          detail: undefined as string | undefined
        }
        result.steps.push(entry)
        if (stopped) {
          persist()
          continue
        }
        const started = Date.now()
        try {
          switch (step.verb) {
            case 'click':
              await page.getByText(step.text, { exact: true }).click({ timeout: 15_000 })
              break
            case 'clickRole':
              await page.getByRole(step.role, { name: step.name, exact: true }).click({ timeout: 15_000 })
              break
            case 'fill':
              await page.locator(step.selector).fill(step.text, { timeout: 15_000 })
              break
            case 'key':
              await page.keyboard.press(step.key)
              break
            case 'waitFor':
              await page.locator(step.selector).waitFor({ state: 'visible', timeout: step.timeout ?? 15_000 })
              break
            case 'expectText':
              await expect(page.getByText(step.text).first()).toBeVisible({ timeout: step.timeout ?? 15_000 })
              break
            case 'expectVisible':
              await expect(page.locator(step.selector).first()).toBeVisible({ timeout: step.timeout ?? 15_000 })
              break
            case 'screenshot':
              await screenshot(step.name)
              break
            case 'sleep':
              await page.waitForTimeout(step.ms)
              break
          }
          entry.status = 'passed'
        } catch (error) {
          const unavailable = page.isClosed() || !page.context().browser()?.isConnected()
          const screenshotFailed = step.verb === 'screenshot'
          entry.status = 'failed'
          entry.detail = error instanceof Error ? error.message : String(error)
          addFailure(
            result,
            new QaError(
              screenshotFailed && !unavailable ? 'report' : 'steps',
              unavailable ? 3 : screenshotFailed ? 2 : 1,
              unavailable ? 'APP_UNAVAILABLE' : screenshotFailed ? 'SCREENSHOT_FAILED' : 'ASSERTION_FAILED',
              entry.detail
            )
          )
          stopped = unavailable || screenshotFailed || !options.continueOnFailure
          await screenshot('failure').catch(() => undefined)
        } finally {
          entry.seconds = (Date.now() - started) / 1000
          persist()
        }
      }
    }
  }
}

export async function executePlan(context: ScenarioContext, plan: Plan): Promise<void> {
  await context.runSteps(plan.steps, { continueOnFailure: plan.continueOnFailure })
}
