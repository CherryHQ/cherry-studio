import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium, expect, type Browser, type Page } from '@playwright/test'

import { getSensitiveConfigValues } from '../regression/config'
import { prepareWindowsCdpConnection } from '../regression/debugBridge'
import { prepareRelease } from '../regression/installation'
import { launchApp, readAppRecord, stopOwnedApp } from '../regression/lifecycle'
import { ensureRunDirectories, getRunPaths } from '../regression/paths'
import { createRedactor } from '../regression/redaction'
import { resolveRepositoryRef } from '../regression/ref'
import { captureMaskedScreenshot } from '../regression/screenshotEvidence'
import { collectEnvironment, ensureChinese, verifyTimezone } from './environment'
import { readRequest, type Request } from './plan'
import { prepareAuthenticatedProfile, readProfileConfig, type ProfileConfig } from './profile'
import { addFailure, completeResult, createResult, QaError, readResult, type Result, saveResult } from './report'
import { createScenarioContext, executePlan, type ScenarioContext } from './steps'

const paths = getRunPaths(
  process.env.QA_RUN_DIR ?? join(process.env.RUNNER_TEMP ?? join(process.cwd(), '.context'), 'qa-ondemand')
)
const out = resolve(process.env.QA_OUT ?? paths.output)
const command = process.argv[2]
// Git Bash drops IANA TZ values before launching native Windows programs.
process.env.TZ ??= 'Asia/Shanghai'
let result: Result = createResult()
let secrets = getSensitiveConfigValues()
let interrupted = false
let browser: Browser | undefined

const persist = () => saveResult(out, result, secrets)
function failure(error: unknown): void {
  const phase = result.failureStage ?? 'report'
  addFailure(
    result,
    error instanceof QaError
      ? error
      : new QaError(
          phase,
          phase === 'ready' ? 3 : 2,
          phase === 'ready' ? 'APP_NOT_READY' : 'CONTROLLER_ERROR',
          error instanceof Error ? error.message : String(error)
        )
  )
}
function phase(stage: NonNullable<Result['failureStage']>): void {
  result.failureStage = stage
  persist()
}
async function cleanup(): Promise<void> {
  try {
    if (browser?.isConnected()) await browser.close()
  } catch (error) {
    addFailure(result, new QaError('cleanup', 2, 'DISCONNECT_FAILED', String(error)))
  }
  await stopOwnedApp(paths).catch((error) =>
    addFailure(result, new QaError('cleanup', 2, 'CLEANUP_FAILED', String(error)))
  )
}
function copyLogs(): void {
  if (!existsSync(paths.logs)) return
  const redact = createRedactor(secrets)
  mkdirSync(join(out, 'logs'), { recursive: true })
  for (const file of readdirSync(paths.logs, { withFileTypes: true })) {
    if (!file.isFile()) continue
    const relative = `logs/${file.name}`
    writeFileSync(join(out, relative), redact(readFileSync(join(paths.logs, file.name), 'utf8')), { mode: 0o600 })
    if (!result.artifacts.includes(relative)) result.artifacts.push(relative)
  }
}

async function run(request: Request, profileConfig?: ProfileConfig): Promise<void> {
  result.timings.preparationSeconds = (Date.now() - Date.parse(result.metadata.startedAt)) / 1000
  const readyStarted = Date.now()
  let attachedPage: Page | undefined
  mkdirSync(join(out, 'screenshots'), { recursive: true })
  const remaining = () => {
    const value = 120_000 - (Date.now() - readyStarted)
    if (value <= 0)
      throw new QaError('ready', 3, 'APP_NOT_READY', '应用未就绪: main window exceeded the 120-second readiness budget')
    return value
  }
  const signal = () => {
    interrupted = true
    result.metadata.interruptedAt = new Date().toISOString()
    result.status = 'interrupted'
    result.exitCode = null
    persist()
    void cleanup()
  }
  process.once('SIGTERM', signal)
  process.once('SIGINT', signal)
  phase('ready')
  try {
    const record = await launchApp(paths, {
      mode: request.mode,
      platform: request.platform,
      profile: request.profile,
      targetRoot: resolve(process.env.QA_TARGET_ROOT ?? process.cwd()),
      runKey: `${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-${request.platform}`,
      locale: 'zh-CN',
      readyTimeoutMs: remaining()
    })
    await prepareWindowsCdpConnection(record)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${record.cdpPort}`, {
      isLocal: true,
      noDefaults: true,
      timeout: remaining()
    })
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => {
        try {
          return new URL(candidate.url()).pathname.endsWith('/windows/main/index.html')
        } catch {
          return false
        }
      })
    if (!page) throw new QaError('ready', 3, 'APP_NOT_READY', '应用未就绪: owned main window is unavailable')
    attachedPage = page
    await expect(page.locator('[data-ui~="app.shell"]:visible, [data-onboarding-language-select]:visible')).toBeVisible(
      {
        timeout: remaining()
      }
    )
    result.timings.readinessSeconds = (Date.now() - readyStarted) / 1000
    phase('environment')
    try {
      if (profileConfig) await prepareAuthenticatedProfile(page, profileConfig)
      await ensureChinese(page, true)
    } finally {
      await collectEnvironment(page, readAppRecord(paths), result)
    }
    verifyTimezone(
      request.plan?.requiredTimezone,
      result.environment.timezone.main,
      result.environment.timezone.renderer
    )
    mkdirSync(join(out, 'screenshots'), { recursive: true })
    const context = createScenarioContext(page, result, out, secrets, persist, () => ensureChinese(page, true))
    phase('steps')
    const started = Date.now()
    try {
      if (request.plan) await executePlan(context, request.plan)
      else {
        const loaded = await import(pathToFileURL(request.file!).href)
        const scenario = typeof loaded.default === 'function' ? loaded.default : loaded.default?.default
        if (typeof scenario !== 'function')
          throw new Error('Named spec must export a default async function accepting ScenarioContext')
        await (scenario as (context: ScenarioContext) => Promise<void>)(context)
      }
      if (!result.steps.length || (result.steps.some((step) => step.status === 'not_run') && !result.errors.length))
        throw new Error('No complete required steps were recorded')
    } catch (error) {
      if (page.isClosed() || !browser.isConnected()) throw new QaError('steps', 3, 'APP_UNAVAILABLE', String(error))
      throw error
    } finally {
      result.timings.stepsSeconds = (Date.now() - started) / 1000
      if (!page.isClosed() && browser.isConnected()) {
        await ensureChinese(page).catch(failure)
        await collectEnvironment(page, record, result).catch(failure)
        try {
          verifyTimezone(
            request.plan?.requiredTimezone,
            result.environment.timezone.main,
            result.environment.timezone.renderer
          )
        } catch (error) {
          failure(error)
        }
        await context
          .screenshot(result.errors.length ? 'failure' : 'final')
          .catch((error) => addFailure(result, new QaError('report', 2, 'SCREENSHOT_FAILED', String(error))))
      } else
        addFailure(
          result,
          new QaError('steps', 3, 'APP_UNAVAILABLE', 'Application disconnected before final verification')
        )
    }
  } catch (error) {
    if (error instanceof AggregateError && error.errors.length > 1)
      addFailure(result, new QaError('cleanup', 2, 'CLEANUP_FAILED', String(error.errors[1])))
    if (result.failureStage === 'ready') result.timings.readinessSeconds = (Date.now() - readyStarted) / 1000
    if (attachedPage && !attachedPage.isClosed()) {
      await collectEnvironment(attachedPage, readAppRecord(paths), result).catch((error) =>
        result.environment.unavailable.push(String(error))
      )
      const shot = await captureMaskedScreenshot(attachedPage, secrets).catch(() => undefined)
      if (shot) {
        writeFileSync(join(out, 'screenshots/controller-failure.png'), shot)
        result.artifacts.push('screenshots/controller-failure.png')
      }
    }
    failure(error)
  } finally {
    await cleanup()
    process.removeListener('SIGTERM', signal)
    process.removeListener('SIGINT', signal)
    if (interrupted) {
      result.status = 'interrupted'
      result.exitCode = null
    } else completeResult(result)
    try {
      copyLogs()
    } catch (error) {
      addFailure(result, new QaError('report', 2, 'LOG_COLLECTION_FAILED', String(error)))
      if (!interrupted) completeResult(result)
    }
    persist()
  }
}

async function main(): Promise<void> {
  ensureRunDirectories(paths)
  if (command !== 'resolve' && command !== 'initialize' && existsSync(join(out, 'results.json')))
    result = readResult(out)
  const request = readRequest()
  secrets = [
    ...secrets,
    ...(request.plan?.steps.flatMap((step) => (step.verb === 'fill' && step.text ? [step.text] : [])) ?? [])
  ]
  switch (command) {
    case 'resolve': {
      if (request.profile === 'authenticated') readProfileConfig()
      const target = resolveRepositoryRef(request.ref, process.env.GITHUB_REPOSITORY ?? 'CherryHQ/cherry-studio')
      if (target.kind !== request.mode)
        throw new QaError(
          'input',
          2,
          'REF_MODE_MISMATCH',
          `mode=${request.mode} does not match ${target.kind} ${target.name}`
        )
      if (process.env.GITHUB_OUTPUT) {
        for (const [key, value] of Object.entries({
          sha: target.sha,
          short_sha: target.sha.slice(0, 7),
          name: target.name,
          mode: target.kind,
          spec: request.spec,
          platform: request.platform,
          timeout: request.timeoutMinutes,
          runner: request.platform === 'windows' ? 'windows-2022' : 'macos-latest'
        })) {
          appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
        }
      } else process.stdout.write(`${JSON.stringify(target)}\n`)
      return
    }
    case 'initialize':
      phase('prepare')
      return
    case 'release':
      phase('prepare')
      await prepareRelease(paths, {
        repository: process.env.GITHUB_REPOSITORY ?? 'CherryHQ/cherry-studio',
        ref: request.ref,
        platform: request.platform,
        arch: process.env.RUNNER_ARCH ?? process.arch
      })
      return
    case 'run': {
      phase('prepare')
      const profileConfig = request.profile === 'authenticated' ? readProfileConfig() : undefined
      await run(request, profileConfig)
      break
    }
    case 'finalize':
      if (process.env.QA_CANCELLED === 'true' || result.metadata.interruptedAt) interrupted = true
      await cleanup()
      if (interrupted) {
        result.status = 'interrupted'
        result.exitCode = null
        persist()
        break
      }
      if (result.status === 'interrupted') {
        result.timings.preparationSeconds = (Date.now() - Date.parse(result.metadata.startedAt)) / 1000
        addFailure(
          result,
          new QaError(
            result.failureStage ?? 'prepare',
            2,
            'INCOMPLETE_EXECUTION',
            'Preparation or controller terminated before test completion'
          )
        )
      }
      completeResult(result)
      copyLogs()
      persist()
      break
    default:
      throw new Error('Expected resolve, initialize, release, run, or finalize')
  }
  process.exitCode = result.exitCode ?? 130
}

main().catch((error) => {
  if (result.failureStage === 'prepare')
    result.timings.preparationSeconds = (Date.now() - Date.parse(result.metadata.startedAt)) / 1000
  failure(error)
  completeResult(result)
  persist()
  process.stderr.write(`${createRedactor(secrets)(error instanceof Error ? error.message : String(error))}\n`)
  process.exitCode = result.exitCode ?? 2
})
