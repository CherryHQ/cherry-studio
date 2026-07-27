import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Model } from '@shared/data/types/model'
import type { LanguageModelUsage } from 'ai'
import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentLoopHooks } from '../../runtime/aiSdk'

const mockRecordRequest = vi.fn()

vi.mock('@main/data/services/aiUsageRecord', () => ({
  aiUsageRecordService: {
    recordRequest: (...args: unknown[]) => mockRecordRequest(...args)
  }
}))

const { BILLABLE_AI_OPERATIONS, createBillingHook, createBillingRecorder, AI_USAGE_RECORD_OPERATION_COVERAGE } =
  await import('../billingHook')

const model = { id: 'test-provider::test-model' } as unknown as Model

interface ProviderRequestCallSite {
  file: string
  module: string
  exportName: string
  callCount: number
}

// These exports only build schemas, tools, middleware, or inspect errors and
// cannot issue a provider request. Every other value import is review-required
// by default so a newly added SDK inference API cannot silently bypass billing.
const AI_SDK_NON_REQUEST_EXPORTS = new Set([
  'APICallError',
  'InvalidToolInputError',
  'Output',
  'asSchema',
  'convertToModelMessages',
  'dynamicTool',
  'extractReasoningMiddleware',
  'isToolUIPart',
  'jsonSchema',
  'readUIMessageStream',
  'simulateStreamingMiddleware',
  'stepCountIs',
  'tool',
  'zodSchema'
])
const AI_CORE_NON_REQUEST_EXPORTS = new Set(['definePlugin'])

function scanProviderRequestCallSites(): ProviderRequestCallSite[] {
  const mainRoot = fileURLToPath(new URL('../../..', import.meta.url))
  const result: ProviderRequestCallSite[] = []

  for (const relativePath of globSync('**/*.ts', { cwd: mainRoot, exclude: ['**/__tests__/**'] })) {
    const source = ts.createSourceFile(
      relativePath,
      readFileSync(join(mainRoot, relativePath), 'utf8'),
      ts.ScriptTarget.Latest,
      true
    )
    const requestImports = new Map<string, { module: string; exportName: string }>()

    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.importClause?.isTypeOnly
      ) {
        continue
      }

      const module = statement.moduleSpecifier.text
      if (module !== '@cherrystudio/ai-core' && module !== 'ai') continue

      const bindings = statement.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) {
        requestImports.set('*', { module, exportName: '*' })
        continue
      }

      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue
        const exportName = (element.propertyName ?? element.name).text
        const isRequest =
          module === '@cherrystudio/ai-core'
            ? !AI_CORE_NON_REQUEST_EXPORTS.has(exportName)
            : !AI_SDK_NON_REQUEST_EXPORTS.has(exportName)
        if (isRequest) requestImports.set(element.name.text, { module, exportName })
      }
    }

    const callCounts = new Map<string, number>()
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && requestImports.has(node.expression.text)) {
        callCounts.set(node.expression.text, (callCounts.get(node.expression.text) ?? 0) + 1)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)

    for (const [localName, requestImport] of requestImports) {
      result.push({
        file: relativePath.replaceAll('\\', '/'),
        ...requestImport,
        callCount: callCounts.get(localName) ?? 0
      })
    }
  }

  return result.toSorted((a, b) => a.file.localeCompare(b.file) || a.exportName.localeCompare(b.exportName))
}

// The hook only reads `step.usage`; build a minimal fake step (a full
// StepResult has 20+ fields we don't need here).
const fakeStep = (usage: Partial<LanguageModelUsage>) =>
  ({ usage }) as unknown as Parameters<NonNullable<AgentLoopHooks['onStepFinish']>>[0]

describe('AI usage record operation coverage', () => {
  it('classifies every billable AiService operation', () => {
    expect(Object.keys(AI_USAGE_RECORD_OPERATION_COVERAGE)).toEqual(BILLABLE_AI_OPERATIONS)
    expect(AI_USAGE_RECORD_OPERATION_COVERAGE).toMatchObject({
      streamText: { status: 'recorded', modality: 'language', capture: 'agent-hook' },
      generateText: { status: 'recorded', modality: 'language', capture: 'agent-hook' },
      embedMany: { status: 'recorded', modality: 'embedding', capture: 'direct' },
      generateImage: { status: 'recorded', modality: 'image', capture: 'direct' },
      rerank: { status: 'usage-unavailable', reason: 'ai-sdk-rerank-result-has-no-usage-or-cost' }
    })
  })

  it('allows raw provider requests only through reviewed capture owners', () => {
    expect(scanProviderRequestCallSites()).toEqual([
      {
        file: 'ai/AiService.ts',
        module: '@cherrystudio/ai-core',
        exportName: 'embedMany',
        callCount: 1
      },
      {
        file: 'ai/AiService.ts',
        module: '@cherrystudio/ai-core',
        exportName: 'generateImage',
        callCount: 1
      },
      {
        file: 'ai/AiService.ts',
        module: '@cherrystudio/ai-core',
        exportName: 'rerank',
        callCount: 1
      },
      {
        file: 'ai/runtime/aiSdk/Agent.ts',
        module: '@cherrystudio/ai-core',
        exportName: 'createAgent',
        callCount: 1
      },
      {
        file: 'ai/tools/adapters/aiSdk/repair.ts',
        module: '@cherrystudio/ai-core',
        exportName: 'generateText',
        callCount: 1
      }
    ])
  })
})

// What the usage record must contain, and when it is written. A run ends through
// exactly one terminal hook, but only `onFinish` means "clean end" — usage
// accrued before an abort or a throwing step must still reach the record, and
// exactly once. Wiring details (id threading, zero-guard) live in AiService.test.
describe('createBillingHook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: resolve, like the real record store's best-effort contract. Individual
    // tests override with mockRejectedValueOnce to exercise the failure path.
    mockRecordRequest.mockResolvedValue(undefined)
  })

  it('records the usage accrued across steps when the run is aborted', () => {
    const apiKeySnapshot = { id: 'key-a', label: 'Primary', masked: 'sk-a****aaaa' }
    const hook = createBillingHook(model, 'assistant-abort', apiKeySnapshot)

    void hook.onStepFinish?.(fakeStep({ inputTokens: 6, outputTokens: 3, totalTokens: 9 }))
    void hook.onStepFinish?.(fakeStep({ inputTokens: 4, outputTokens: 2, totalTokens: 6 }))
    void hook.onAbort?.()

    expect(mockRecordRequest).toHaveBeenCalledTimes(1)
    expect(mockRecordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'assistant-abort',
        apiKeySnapshot,
        modality: 'language',
        stats: expect.objectContaining({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
      })
    )
  })

  it('records the usage accrued across steps when a later step errors', () => {
    const hook = createBillingHook(model, 'assistant-error')

    void hook.onStepFinish?.(fakeStep({ inputTokens: 6, outputTokens: 3, totalTokens: 9 }))
    void hook.onStepFinish?.(fakeStep({ inputTokens: 4, outputTokens: 2, totalTokens: 6 }))
    const outcome = hook.onError?.({ error: new Error('step blew up') })

    // Terminating semantics are unchanged: the hook still stops the run.
    expect(outcome).toBe('abort')
    expect(mockRecordRequest).toHaveBeenCalledTimes(1)
    expect(mockRecordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'assistant-error',
        modality: 'language',
        stats: expect.objectContaining({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
      })
    )
  })

  // An OpenRouter-style `usage.cost` prices a single generation, and every
  // step is one — the usage record must carry the sum, not the last step's cost.
  it('records the provider-reported cost summed over every step', () => {
    const hook = createBillingHook(model, 'assistant-cost')

    void hook.onStepFinish?.(fakeStep({ inputTokens: 6, outputTokens: 3, totalTokens: 9, raw: { cost: 0.25 } }))
    void hook.onStepFinish?.(fakeStep({ inputTokens: 4, outputTokens: 2, totalTokens: 6, raw: { cost: 0.5 } }))
    void hook.onFinish?.()

    expect(mockRecordRequest).toHaveBeenCalledWith(expect.objectContaining({ providerCostUsd: 0.75 }))
  })

  it('records once when a finished run also reports abort or error', () => {
    const hook = createBillingHook(model, 'assistant-finish')

    void hook.onStepFinish?.(fakeStep({ inputTokens: 6, outputTokens: 3, totalTokens: 9 }))
    void hook.onFinish?.()
    void hook.onAbort?.()
    void hook.onError?.({ error: new Error('late error') })

    expect(mockRecordRequest).toHaveBeenCalledTimes(1)
    expect(mockRecordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: expect.objectContaining({ inputTokens: 6, outputTokens: 3, totalTokens: 9 })
      })
    )
  })

  it('records an observed request whose usage counters are explicitly zero', () => {
    const hook = createBillingHook(model, 'assistant-zero')

    void hook.onStepFinish?.(fakeStep({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }))
    void hook.onFinish?.()

    expect(mockRecordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'assistant-zero',
        stats: expect.objectContaining({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
      })
    )
  })

  it('records a provider charge even when every usage counter is zero', () => {
    const hook = createBillingHook(model, 'assistant-provider-cost')

    void hook.onStepFinish?.(fakeStep({ inputTokens: 0, outputTokens: 0, totalTokens: 0, raw: { cost: 0.125 } }))
    void hook.onFinish?.()

    expect(mockRecordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'assistant-provider-cost',
        providerCostUsd: 0.125,
        stats: expect.objectContaining({ totalTokens: 0 })
      })
    )
  })

  it('merges nested repair usage into the parent request and preserves its source snapshot', () => {
    const source = { type: 'assistant', id: 'assistant-1', name: 'Research', icon: '🔎' } as const
    const recorder = createBillingRecorder(model, 'assistant-repaired', undefined, source)

    recorder.recordUsage({ inputTokens: 5, outputTokens: 1, totalTokens: 6 } as LanguageModelUsage)
    void recorder.hook.onStepFinish?.(fakeStep({ inputTokens: 7, outputTokens: 2, totalTokens: 9 }))
    void recorder.hook.onFinish?.()

    expect(mockRecordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'assistant-repaired',
        source,
        stats: expect.objectContaining({ inputTokens: 12, outputTokens: 3, totalTokens: 15 })
      })
    )
  })

  // The central safety claim: a rejecting record write must never surface out of the
  // hook (there is no request to fail — `onFinish` is void and fire-and-forget).
  it('does not throw and settles the rejection when the record write fails', async () => {
    mockRecordRequest.mockRejectedValueOnce(new Error('usage record unavailable'))
    const hook = createBillingHook(model, 'assistant-reject')

    void hook.onStepFinish?.(fakeStep({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }))
    expect(() => hook.onFinish?.()).not.toThrow()

    expect(mockRecordRequest).toHaveBeenCalledTimes(1)
    // Let the rejected promise's `.catch(...)` run — an unattended rejection here
    // would surface as an unhandled rejection failing the test.
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
})
