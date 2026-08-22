import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'

import { getRegressionCase, REGRESSION_CASES, SUITE_IDS } from './cases'
import { CONFIG_REFS, getSensitiveConfigValues, loadTestConfig } from './config'
import { type InteractionRequest, type LocatorDescriptor, RegressionController, type WindowScope } from './controller'
import type { FileEvidenceOptions } from './file-evidence'
import { FIXTURE_MARKERS } from './fixtures'
import { ensureProfile, type InstallationRecord, readAppRecord, restartApp } from './lifecycle'
import { getRunPaths, resolveAllowedPath } from './paths'
import { listOwnedProcessIds } from './process-evidence'
import { createRedactor } from './redaction'
import { addEvidence, beginCase, completeCase, readRun, writeRun } from './state'
import { chooseNativeFile, openExternalText, sendSystemHotkey } from './system-automation'
import type { EvidenceRecord, Platform, SuiteId } from './types'

const locatorSchema = z.object({
  scope: z.enum(['any', 'main', 'quick-assistant', 'selection-assistant']).optional(),
  role: z.string().min(1).optional(),
  name: z.string().optional(),
  nameConfigRef: z
    .enum(Object.keys(CONFIG_REFS) as [keyof typeof CONFIG_REFS, ...(keyof typeof CONFIG_REFS)[]])
    .optional(),
  label: z.string().min(1).optional(),
  placeholder: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  textConfigRef: z
    .enum(Object.keys(CONFIG_REFS) as [keyof typeof CONFIG_REFS, ...(keyof typeof CONFIG_REFS)[]])
    .optional(),
  testId: z.string().min(1).optional(),
  css: z.string().min(1).optional(),
  exact: z.boolean().optional(),
  nth: z.number().int().min(0).optional()
})

const interactionSchema = z.object({
  action: z.enum([
    'check',
    'click',
    'download',
    'fill',
    'focus',
    'hover',
    'press',
    'select',
    'set-files',
    'uncheck',
    'wait'
  ]),
  locator: locatorSchema.optional(),
  value: z.string().optional(),
  configRef: z.enum(Object.keys(CONFIG_REFS) as [keyof typeof CONFIG_REFS, ...(keyof typeof CONFIG_REFS)[]]).optional(),
  key: z.string().optional(),
  files: z.array(z.string().min(1)).optional(),
  waitMs: z.number().int().min(0).max(30_000).optional()
})

const evidenceSchema = z.object({
  caseId: z.string().min(1),
  evidenceId: z.string().min(1),
  kind: z.enum(['file', 'process', 'restart', 'screenshot', 'ui']),
  summary: z.string().min(1),
  locator: locatorSchema.optional(),
  expectedText: z.string().optional(),
  path: z.string().optional(),
  scope: z.enum(['any', 'main', 'quick-assistant', 'selection-assistant']).optional()
})

const locatorInputSchema = {
  type: 'object',
  properties: {
    scope: { enum: ['any', 'main', 'quick-assistant', 'selection-assistant'], type: 'string' },
    role: { type: 'string' },
    name: { type: 'string' },
    nameConfigRef: { enum: Object.keys(CONFIG_REFS), type: 'string' },
    label: { type: 'string' },
    placeholder: { type: 'string' },
    text: { type: 'string' },
    textConfigRef: { enum: Object.keys(CONFIG_REFS), type: 'string' },
    testId: { type: 'string' },
    css: { type: 'string' },
    exact: { type: 'boolean' },
    nth: { minimum: 0, type: 'integer' }
  },
  additionalProperties: false
} as const

const toolDefinitions = [
  {
    name: 'get-run-context',
    description:
      'Read this suite, case contracts, fixture paths, capability results, and current statuses. Never returns secrets.',
    inputSchema: { type: 'object', additionalProperties: false }
  },
  {
    name: 'begin-case',
    description:
      'Start one case in this suite and switch Cherry Studio to its isolated profile. Capability-blocked cases are closed automatically.',
    inputSchema: {
      type: 'object',
      properties: { caseId: { type: 'string' } },
      required: ['caseId'],
      additionalProperties: false
    }
  },
  {
    name: 'inspect-ui',
    description: 'Inspect live Cherry Studio UI through CDP using an accessibility-first locator.',
    inputSchema: {
      type: 'object',
      properties: { locator: locatorInputSchema },
      additionalProperties: false
    }
  },
  {
    name: 'interact',
    description:
      'Perform one live CDP interaction. Use configRef for configured models, credentials, base URL, and API key so their values stay hidden.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        locator: locatorInputSchema,
        value: { type: 'string' },
        configRef: { type: 'string', enum: Object.keys(CONFIG_REFS) },
        key: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        waitMs: { type: 'number' }
      },
      required: ['action'],
      additionalProperties: false
    }
  },
  {
    name: 'system-action',
    description:
      'Operate the hosted runner desktop for a global shortcut, external text selection, Escape, or a native file picker.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { enum: ['hotkey', 'native-file-picker', 'open-external-text', 'press-escape'], type: 'string' },
        keys: { type: 'array', items: { type: 'string' } },
        path: { type: 'string' }
      },
      required: ['action'],
      additionalProperties: false
    }
  },
  {
    name: 'restart-app',
    description:
      'Gracefully restart only the owned Cherry Studio instance. Reopen the tested state before recording restart evidence.',
    inputSchema: { type: 'object', additionalProperties: false }
  },
  {
    name: 'record-evidence',
    description:
      'Create machine-verified evidence declared by the current case. A failed observation is recorded but cannot satisfy the pass gate.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string' },
        evidenceId: { type: 'string' },
        kind: { enum: ['file', 'process', 'restart', 'screenshot', 'ui'], type: 'string' },
        summary: { type: 'string' },
        locator: locatorInputSchema,
        expectedText: { type: 'string' },
        path: { type: 'string' },
        scope: { enum: ['any', 'main', 'quick-assistant', 'selection-assistant'], type: 'string' }
      },
      required: ['caseId', 'evidenceId', 'kind', 'summary'],
      additionalProperties: false
    }
  },
  {
    name: 'complete-case',
    description:
      'Finish a case as passed, failed, or blocked. Passed is rejected unless every declared evidence item passed machine verification.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string' },
        status: { enum: ['blocked', 'failed', 'passed'], type: 'string' },
        summary: { type: 'string' }
      },
      required: ['caseId', 'status', 'summary'],
      additionalProperties: false
    }
  }
]

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the Cherry regression MCP server`)
  return value
}

const runDirectory = requiredEnvironment('CHERRY_TEST_RUN_DIR')
const suite = requiredEnvironment('CHERRY_TEST_SUITE') as SuiteId
if (!SUITE_IDS.includes(suite)) throw new Error(`Invalid Cherry regression suite: ${suite}`)

const paths = getRunPaths(runDirectory)
const config = loadTestConfig()
const redact = createRedactor(getSensitiveConfigValues(config))
const controller = new RegressionController(paths, config, redact)
const processBaselines = new Map<string, ReadonlySet<number>>()
const restartBaselines = new Map<string, number>()

function log(event: string, details: unknown): void {
  appendFileSync(
    `${paths.logs}/driver.ndjson`,
    `${JSON.stringify(redact({ at: new Date().toISOString(), details, event, suite }))}\n`,
    { mode: 0o600 }
  )
}

function response(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(redact(value), null, 2) }],
    ...(isError ? { isError: true } : {})
  }
}

function assertSuiteCase(caseId: string) {
  const testCase = getRegressionCase(caseId)
  if (testCase.suite !== suite) throw new Error(`${caseId} belongs to ${testCase.suite}, not ${suite}`)
  return testCase
}

function requireRunningCase(caseId: string): void {
  const result = readRun(paths.runState).cases[caseId]
  if (result?.status !== 'running') throw new Error(`${caseId} must be running before evidence is recorded`)
}

function fileContract(evidenceId: string): { expectedPath?: string; options: FileEvidenceOptions } {
  switch (evidenceId) {
    case 'installed-app': {
      const installation = JSON.parse(readFileSync(paths.installation, 'utf8')) as InstallationRecord
      return { expectedPath: installation.executablePath, options: { minimumBytes: 1, type: 'file' } }
    }
    case 'ppt-file':
      return {
        expectedPath: join(paths.workspace, 'cherry-regression-31415.pptx'),
        options: {
          exactSlides: FIXTURE_MARKERS.pptSlides,
          expectedText: FIXTURE_MARKERS.pptTitle,
          minimumBytes: 1_024,
          type: 'pptx'
        }
      }
    case 'claude-file':
      return {
        expectedPath: join(paths.workspace, 'claude-agent-result.txt'),
        options: { expectedText: FIXTURE_MARKERS.agentFile, type: 'text' }
      }
    case 'pi-file':
      return {
        expectedPath: join(paths.workspace, 'pi-agent-result.txt'),
        options: { expectedText: FIXTURE_MARKERS.agentFile, type: 'text' }
      }
    case 'dsh-file':
      return {
        expectedPath: join(paths.workspace, 'dsh-agent-result.txt'),
        options: { expectedText: FIXTURE_MARKERS.agentFile, type: 'text' }
      }
    case 'selection-source-preserved':
      return {
        expectedPath: join(paths.fixtures, 'selection.txt'),
        options: { expectedText: FIXTURE_MARKERS.selection, type: 'text' }
      }
    case 'gemini-image-file':
    case 'image2-file':
      return { options: { minimumBytes: 1_024, type: 'image' } }
    default:
      throw new Error(`No file validation contract is defined for ${evidenceId}`)
  }
}

function processContract(evidenceId: string): { commandFragment: string; expectedRunning: boolean } {
  switch (evidenceId) {
    case 'claude-code-process':
      return { commandFragment: 'claude', expectedRunning: true }
    case 'codex-process':
      return { commandFragment: 'codex', expectedRunning: true }
    case 'openclaw-gateway':
      return { commandFragment: 'openclaw', expectedRunning: true }
    case 'openclaw-stopped':
      return { commandFragment: 'openclaw', expectedRunning: false }
    default:
      throw new Error(`No process validation contract is defined for ${evidenceId}`)
  }
}

function restartExpectedText(evidenceId: string): string {
  switch (evidenceId) {
    case 'cherryin-restart':
      return config.cherryIn.chatModel
    case 'custom-provider-restart':
      return FIXTURE_MARKERS.customProviderName
    case 'assistant-restart':
      return FIXTURE_MARKERS.assistantName
    case 'quick-restart':
      return 'QUICK_ASSISTANT_PASS'
    case 'knowledge-restart':
      return FIXTURE_MARKERS.knowledgeName
    case 'everything-restart':
      return FIXTURE_MARKERS.everythingName
    case 'claude-restart':
      return FIXTURE_MARKERS.claudeAgentName
    case 'note-restart':
      return FIXTURE_MARKERS.noteTitle
    default:
      throw new Error(`No restart validation contract is defined for ${evidenceId}`)
  }
}

function uiExpectedTexts(evidenceId: string, requested?: string): string[] {
  const contracts: Record<string, string[]> = {
    'app-version': [readRun(paths.runState).metadata.appVersion],
    'assistant-saved': [FIXTURE_MARKERS.assistantName],
    'assistant-prompt-response': [FIXTURE_MARKERS.assistantResponse],
    'cherryin-identity': [config.cherryIn.account],
    'cherryin-chat-response': [FIXTURE_MARKERS.cherryInChat],
    'claude-runtime': [FIXTURE_MARKERS.claudeAgentName],
    'codex-directory': ['agent-workspace'],
    'custom-provider-saved': [FIXTURE_MARKERS.customProviderName, config.customProvider.chatModel],
    'custom-provider-chat-response': [FIXTURE_MARKERS.customProviderChat],
    'dsh-runtime': ['DeepSeek'],
    'everything-tools': ['get-sum', 'echo'],
    'everything-result': ['58597'],
    'everything-tool-call': ['31415', '27182'],
    'gemini-image-history': [FIXTURE_MARKERS.imagePrompt],
    'gemini-image-visible': [config.cherryIn.geminiImageModel],
    'image2-history': [FIXTURE_MARKERS.imagePrompt],
    'image2-visible': [config.cherryIn.image2Model],
    'knowledge-answer': [FIXTURE_MARKERS.knowledge],
    'knowledge-citation': ['ground-truth.txt'],
    'knowledge-query': [FIXTURE_MARKERS.knowledge],
    'knowledge-recall': [FIXTURE_MARKERS.knowledge],
    'note-reopened': [FIXTURE_MARKERS.noteTitle, FIXTURE_MARKERS.noteBody],
    'pdf-imported': [FIXTURE_MARKERS.pdf],
    'pdf-translation': [FIXTURE_MARKERS.pdf],
    'pi-runtime': ['Pi'],
    'ppt-opened': [FIXTURE_MARKERS.pptTitle],
    'quick-model-response': ['QUICK_ASSISTANT_PASS'],
    'selection-model-response': [FIXTURE_MARKERS.selection],
    'selection-source': [FIXTURE_MARKERS.selection],
    'skill-imported': ['cherry-regression-fixture'],
    'skill-behavior': [FIXTURE_MARKERS.skill],
    'text-translation': ['Neptune', '27182', 'TRANSLATION_MARKER'],
    'translation-history': ['Neptune', '27182', 'TRANSLATION_MARKER']
  }
  const expected = contracts[evidenceId]
  if (expected) return expected
  if (!requested) throw new Error(`${evidenceId} requires expectedText`)
  return [requested]
}

async function recordMachineEvidence(input: z.infer<typeof evidenceSchema>): Promise<EvidenceRecord> {
  const testCase = assertSuiteCase(input.caseId)
  requireRunningCase(input.caseId)
  const requirement = testCase.evidence.find(({ id }) => id === input.evidenceId)
  if (!requirement) throw new Error(`${input.evidenceId} is not declared for ${input.caseId}`)
  if (requirement.kind !== input.kind) {
    throw new Error(`${input.caseId}/${input.evidenceId} requires ${requirement.kind}, not ${input.kind}`)
  }

  let observation: { artifactPath?: string; details?: unknown; passed: boolean }
  switch (input.kind) {
    case 'ui':
      if (input.evidenceId === 'quick-escape-close') {
        observation = (await controller.recordWindowAbsent(
          input.caseId,
          input.evidenceId,
          'quick-assistant'
        )) as typeof observation
        break
      }
      if (!input.locator) throw new Error('UI evidence requires locator')
      observation =
        input.evidenceId === 'custom-provider-redacted'
          ? ((await controller.recordMaskedInput(
              input.caseId,
              input.evidenceId,
              input.locator as LocatorDescriptor,
              config.customProvider.apiKey
            )) as typeof observation)
          : ((await controller.recordUi(
              input.caseId,
              input.evidenceId,
              input.locator as LocatorDescriptor,
              uiExpectedTexts(input.evidenceId, input.expectedText)
            )) as typeof observation)
      break
    case 'screenshot':
      observation = (await controller.recordScreenshot(
        input.caseId,
        input.evidenceId,
        input.scope as WindowScope | undefined
      )) as typeof observation
      break
    case 'file':
      if (!input.path) throw new Error('File evidence requires path')
      const contract = fileContract(input.evidenceId)
      if (contract.expectedPath) {
        const observedPath = resolveAllowedPath(input.path, [
          paths.artifacts,
          paths.evidence,
          paths.fixtures,
          paths.installed,
          paths.workspace
        ])
        if (observedPath !== contract.expectedPath) {
          throw new Error(`${input.evidenceId} must validate ${contract.expectedPath}`)
        }
      }
      observation = (await controller.recordFile(input.path, contract.options)) as typeof observation
      if (!['installed-app', 'selection-source-preserved'].includes(input.evidenceId)) {
        const details = observation.details as { modifiedAt?: string; sha256?: string }
        const result = readRun(paths.runState).cases[input.caseId]
        const contractFailures: string[] = []
        const startedAt = Date.parse(result.startedAt ?? '')
        if (!Number.isFinite(startedAt) || !details.modifiedAt || Date.parse(details.modifiedAt) < startedAt - 2_000) {
          contractFailures.push('The artifact was not created or updated during this case')
        }
        if (input.evidenceId === 'image2-file') {
          const geminiEvidence = readRun(paths.runState).cases['P-01'].evidence.find(
            ({ id }) => id === 'gemini-image-file'
          )
          const geminiSha = (geminiEvidence?.details as { sha256?: string } | undefined)?.sha256
          if (geminiSha && details.sha256 === geminiSha) {
            contractFailures.push('Image 2 reused the Gemini evidence file without producing a distinct image')
          }
        }
        if (contractFailures.length > 0) {
          observation = {
            ...observation,
            details: { ...details, contractFailures },
            passed: false
          }
        }
      }
      break
    case 'process':
      const processExpectation = processContract(input.evidenceId)
      observation = (await controller.recordProcess(
        processExpectation.commandFragment,
        processExpectation.expectedRunning,
        processBaselines.get(input.caseId) ?? new Set()
      )) as typeof observation
      break
    case 'restart': {
      if (!input.locator) throw new Error('Restart evidence requires locator')
      const baseline = restartBaselines.get(input.caseId)
      if (baseline === undefined) throw new Error(`${input.caseId} has no restart baseline; call begin-case first`)
      observation = (await controller.recordRestart(
        input.locator as LocatorDescriptor,
        [restartExpectedText(input.evidenceId)],
        baseline
      )) as typeof observation
      break
    }
    default:
      throw new Error(`Unsupported evidence kind: ${input.kind satisfies never}`)
  }

  return {
    id: input.evidenceId,
    kind: input.kind,
    observedAt: new Date().toISOString(),
    passed: observation.passed,
    source: 'driver',
    summary: input.summary,
    artifactPath: observation.artifactPath,
    details: observation.details
  }
}

async function handleTool(name: string, rawArguments: unknown): Promise<unknown> {
  switch (name) {
    case 'get-run-context': {
      const run = readRun(paths.runState)
      const fixtures = JSON.parse(readFileSync(`${paths.fixtures}/manifest.json`, 'utf8')) as unknown
      const installation = existsSync(paths.installation)
        ? (JSON.parse(readFileSync(paths.installation, 'utf8')) as unknown)
        : undefined
      let windows: Awaited<ReturnType<RegressionController['listWindows']>> = []
      let windowError: string | undefined
      try {
        windows = await controller.listWindows()
      } catch (error) {
        windowError = error instanceof Error ? error.message : String(error)
      }
      return {
        capabilities: run.capabilities,
        configRefs: Object.keys(CONFIG_REFS),
        fixtures,
        installation,
        metadata: run.metadata,
        suite,
        cases: REGRESSION_CASES.filter((testCase) => testCase.suite === suite).map((testCase) => ({
          ...testCase,
          result: run.cases[testCase.id]
        })),
        windows,
        windowError
      }
    }
    case 'begin-case': {
      const { caseId } = z.object({ caseId: z.string().min(1) }).parse(rawArguments)
      const testCase = assertSuiteCase(caseId)
      let run = readRun(paths.runState)
      const existing = run.cases[caseId]
      if (existing.status !== 'pending' && existing.status !== 'running') {
        return { alreadyCompleted: true, caseId, status: existing.status, summary: existing.summary }
      }
      if (existing.status === 'pending') run = beginCase(run, caseId)
      const unavailable = (testCase.requiredCapabilities ?? []).filter(
        (capability) => !run.capabilities[capability]?.available
      )
      if (unavailable.length > 0) {
        run = completeCase(run, caseId, 'blocked', `Hosted runner capability unavailable: ${unavailable.join(', ')}`)
        writeRun(paths.runState, run)
        return { caseId, status: 'blocked', unavailable }
      }
      await controller.dispose()
      const app = await ensureProfile(paths, testCase.profile)
      processBaselines.set(caseId, new Set(listOwnedProcessIds(app)))
      restartBaselines.set(caseId, app.restartCount)
      writeRun(paths.runState, run)
      return { caseId, profile: app.profile, restartBaseline: app.restartCount, status: 'running' }
    }
    case 'inspect-ui': {
      const input = z.object({ locator: locatorSchema.optional() }).parse(rawArguments)
      return controller.inspect(input.locator as LocatorDescriptor | undefined)
    }
    case 'interact':
      return controller.interact(interactionSchema.parse(rawArguments) as InteractionRequest)
    case 'system-action': {
      const input = z
        .object({
          action: z.enum(['hotkey', 'native-file-picker', 'open-external-text', 'press-escape']),
          keys: z.array(z.string()).optional(),
          path: z.string().optional()
        })
        .parse(rawArguments)
      const run = readRun(paths.runState)
      const platform: Platform = run.metadata.platform
      if (!run.capabilities.desktopAutomation?.available) throw new Error(run.capabilities.desktopAutomation?.detail)
      if (input.action === 'open-external-text') {
        if (!input.path) throw new Error('open-external-text requires path')
        return { opened: openExternalText(platform, paths, input.path) }
      }
      if (input.action === 'native-file-picker') {
        if (!input.path) throw new Error('native-file-picker requires path')
        return { selected: chooseNativeFile(platform, paths, input.path) }
      }
      const keys = input.action === 'press-escape' ? ['Escape'] : input.keys
      if (!keys) throw new Error('hotkey requires keys')
      sendSystemHotkey(platform, keys)
      return { keys, sent: true }
    }
    case 'restart-app': {
      const before = readAppRecord(paths)
      await controller.dispose()
      const after = await restartApp(paths)
      return { afterPid: after.electronPid, beforePid: before.electronPid, restartCount: after.restartCount }
    }
    case 'record-evidence': {
      const input = evidenceSchema.parse(rawArguments)
      const evidence = await recordMachineEvidence(input)
      const run = addEvidence(readRun(paths.runState), input.caseId, evidence)
      writeRun(paths.runState, run)
      return evidence
    }
    case 'complete-case': {
      const input = z
        .object({
          caseId: z.string().min(1),
          status: z.enum(['blocked', 'failed', 'passed']),
          summary: z.string().min(1)
        })
        .parse(rawArguments)
      assertSuiteCase(input.caseId)
      requireRunningCase(input.caseId)
      const run = completeCase(readRun(paths.runState), input.caseId, input.status, input.summary)
      writeRun(paths.runState, run)
      return run.cases[input.caseId]
    }
    default:
      throw new Error(`Unknown Cherry regression tool: ${name}`)
  }
}

const server = new McpServer({ name: 'cherry-regression', version: '1.0.0' }, { capabilities: { tools: {} } })

server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }))
server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await handleTool(request.params.name, request.params.arguments ?? {})
    log(request.params.name, { arguments: request.params.arguments, result })
    return response(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(request.params.name, { arguments: request.params.arguments, error: message })
    return response({ error: message }, true)
  }
})
server.server.onclose = () => {
  void controller.dispose()
}

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exitCode = 1
})
