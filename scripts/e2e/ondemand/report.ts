import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createRedactor } from '../regression/redaction'

export type Stage = 'input' | 'prepare' | 'environment' | 'ready' | 'steps' | 'report' | 'cleanup'
export type ExitCode = 0 | 1 | 2 | 3
export class QaError extends Error {
  constructor(
    readonly stage: Stage,
    readonly exitCode: Exclude<ExitCode, 0>,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}
export interface StepResult {
  step: number
  verb: string
  status: 'passed' | 'failed' | 'not_run'
  seconds: number
  detail?: string
}
export interface Result {
  schemaVersion: 1
  status: 'passed' | 'failed' | 'interrupted'
  exitCode: ExitCode | null
  failureStage: Stage | null
  errors: Array<{ stage: Stage; exitCode: 1 | 2 | 3; code: string; message: string }>
  metadata: {
    spec: string
    platform: string
    mode: string
    profile?: string
    ref: string
    controllerSha: string | null
    applicationSha: string | null
    startedAt: string
    finishedAt: string | null
    interruptedAt?: string
  }
  environment: {
    runner: string | null
    imageOS: string | null
    imageVersion: string | null
    os: string
    arch: string
    appVersion: string | null
    appLocale: string | null
    browserLocale: string | null
    mainLocale: string | null
    timezone: { inherited: string | null; controller: string; main: string | null; renderer: string | null }
    unavailable: string[]
  }
  timings: { preparationSeconds: number; readinessSeconds: number; stepsSeconds: number }
  steps: StepResult[]
  artifacts: string[]
}

export function createResult(env: NodeJS.ProcessEnv = process.env): Result {
  return {
    schemaVersion: 1,
    status: 'interrupted',
    exitCode: null,
    failureStage: 'input',
    errors: [],
    metadata: {
      spec: env.QA_SPEC ?? 'smoke',
      platform: env.QA_PLATFORM ?? 'windows',
      mode: env.QA_MODE ?? 'branch',
      profile: env.QA_PROFILE ?? 'clean',
      ref: env.QA_REF ?? 'main',
      controllerSha: env.GITHUB_SHA ?? null,
      applicationSha: env.QA_SHA ?? null,
      startedAt: new Date().toISOString(),
      finishedAt: null
    },
    environment: {
      runner: env.QA_RUNNER ?? null,
      imageOS: env.ImageOS ?? null,
      imageVersion: env.ImageVersion ?? null,
      os: process.platform,
      arch: process.arch,
      appVersion: null,
      appLocale: null,
      browserLocale: null,
      mainLocale: null,
      timezone: {
        inherited: env.TZ ?? null,
        controller: Intl.DateTimeFormat().resolvedOptions().timeZone,
        main: null,
        renderer: null
      },
      unavailable: []
    },
    timings: { preparationSeconds: 0, readinessSeconds: 0, stepsSeconds: 0 },
    steps: [],
    artifacts: []
  }
}

export function addFailure(result: Result, error: QaError): void {
  result.errors.push({ stage: error.stage, exitCode: error.exitCode, code: error.code, message: error.message })
}

export function completeResult(result: Result): void {
  const priority = { 0: 0, 1: 1, 3: 2, 2: 3 }
  const executionErrors = result.errors.filter((error) => error.stage !== 'cleanup')
  const selected = (executionErrors.length ? executionErrors : result.errors).reduce<
    Result['errors'][number] | undefined
  >(
    (current, error) => (!current || priority[error.exitCode] > priority[current.exitCode] ? error : current),
    undefined
  )
  result.exitCode = selected?.exitCode ?? 0
  result.failureStage = selected?.stage ?? null
  result.status = selected ? 'failed' : 'passed'
  result.metadata.finishedAt = new Date().toISOString()
}

const cell = (value: unknown) =>
  String(value ?? '')
    .replace(/[\r\n]/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
export function markdown(result: Result): string {
  return [
    `## QA on-demand: ${cell(result.metadata.spec)}`,
    `Status: **${result.status}** · exitCode: ${result.exitCode ?? 'null'} · phase: ${result.failureStage ?? 'complete'}`,
    `Application: ${cell(result.environment.appVersion)} · ${cell(result.metadata.platform)} · ${cell(result.metadata.ref)} · ${cell(result.metadata.applicationSha)}`,
    `Controller: ${cell(result.metadata.controllerSha)} · runner: ${cell(result.environment.runner)} · image: ${cell(result.environment.imageOS)} ${cell(result.environment.imageVersion)}`,
    `Locale: ${cell(result.environment.appLocale)} · browser: ${cell(result.environment.browserLocale)} · timezone: ${cell(result.environment.timezone.main)} / ${cell(result.environment.timezone.renderer)}`,
    '',
    '| Preparation (s) | Application readiness (s) | Steps (s) |',
    '|---|---|---|',
    `| ${result.timings.preparationSeconds.toFixed(1)} | ${result.timings.readinessSeconds.toFixed(1)} | ${result.timings.stepsSeconds.toFixed(1)} |`,
    '',
    '| # | Step | Status | Seconds | Detail |',
    '|---|---|---|---|---|',
    ...result.steps.map(
      (step) =>
        `| ${step.step} | ${cell(step.verb)} | ${step.status} | ${step.seconds.toFixed(1)} | ${cell(step.detail)} |`
    ),
    '',
    ...result.errors.map((error) => `- ${error.code} (${error.stage}): ${cell(error.message)}`),
    ...result.environment.unavailable.map((reason) => `- Unavailable observation: ${cell(reason)}`),
    ''
  ].join('\n')
}

export function saveResult(out: string, result: Result, secrets: string[] = []): void {
  mkdirSync(out, { recursive: true })
  const redact = createRedactor(secrets)
  const redacted: Result = {
    ...result,
    errors: result.errors.map((error) => ({ ...error, message: redact(error.message) })),
    steps: result.steps.map((step) => ({ ...step, ...(step.detail ? { detail: redact(step.detail) } : {}) })),
    environment: { ...result.environment, unavailable: result.environment.unavailable.map((reason) => redact(reason)) }
  }
  writeFileSync(join(out, 'results.json.tmp'), `${JSON.stringify(redacted, null, 2)}\n`, { mode: 0o600 })
  renameSync(join(out, 'results.json.tmp'), join(out, 'results.json'))
  writeFileSync(join(out, 'results.md'), markdown(redacted), { mode: 0o600 })
}

export function readResult(out: string): Result {
  return JSON.parse(readFileSync(join(out, 'results.json'), 'utf8')) as Result
}
