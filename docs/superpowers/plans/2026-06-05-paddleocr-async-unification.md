# PaddleOCR Async Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert every PaddleOCR integration in Cherry Studio from one-shot final-result calls to explicit async job semantics, and route all PaddleOCR logic through a single main-process SDK-backed service.

**Architecture:** Add a dedicated main-process PaddleOCR service that owns SDK access, task submission, status/result polling, and result/error mapping. Keep the existing OCR, knowledge preprocess, and file-processing entry points, but change each one to bridge into job-based APIs instead of awaiting final PaddleOCR results inline.

**Tech Stack:** Electron, TypeScript, Vitest, JobManager, renderer shared cache job hooks, file-processing orchestration, PaddleOCR official TypeScript SDK.

---

## File Map

### Create

- `src/main/services/paddleocr/PaddleOcrSdkService.ts` — single PaddleOCR SDK entry point for starting OCR/document jobs, reading status, and retrieving structured results.
- `src/main/services/paddleocr/__tests__/PaddleOcrSdkService.test.ts` — unit tests for config mapping, task/result mapping, and error translation.
- `src/shared/ocr/async.ts` — shared async OCR task/result types used across main, preload, and renderer.
- `src/shared/__tests__/ocr-async.test.ts` — schema/type-level tests for the new shared OCR task contracts.
- `docs/superpowers/plans/2026-06-05-paddleocr-async-unification.md` — this implementation plan.

### Modify

- `package.json` — add the official PaddleOCR TypeScript SDK dependency (`@paddleocr/api-sdk@0.1.0`) if it is not already present.
- `src/renderer/types/ocr.ts` — split current final-result OCR types from new async task start/status/result types.
- `src/shared/IpcChannel.ts` — replace `OCR_ocr` with start/status/result task channels while preserving `OCR_ListProviders`.
- `src/preload/index.ts` — expose async OCR task IPC methods instead of one-shot OCR.
- `src/main/services/ocr/OcrService.ts` — switch OCR main service from final-result dispatch to task dispatch.
- `src/main/services/ocr/builtin/PpocrService.ts` — become a thin adapter into `PaddleOcrSdkService`.
- `src/renderer/services/ocr/OcrService.ts` — expose start/status/result helpers for builtin PaddleOCR usage.
- `src/renderer/hooks/useOcr.ts` — stop wrapping a single final-result promise; instead start jobs and observe them through `useJob` / `useJobProgress`.
- `src/renderer/pages/translate/TranslatePage.tsx` — consume OCR task state and only read result text once the job completes.
- `src/main/services/fileProcessing/processors/paddleocr/document-to-markdown/handler.ts` — remove direct Paddle protocol logic and bridge into the new service.
- `src/main/services/fileProcessing/processors/paddleocr/image-to-text/handler.ts` — stop waiting internally for final text; bridge into task semantics.
- `src/main/services/fileProcessing/processors/paddleocr/utils.ts` — delete direct Paddle-specific request/poll/download/JSONL parsing helpers or reduce to non-Paddle-neutral helpers only.
- `src/main/services/fileProcessing/processors/registry.ts` — keep Paddle registered, but through updated handlers.
- `src/main/knowledge/preprocess/BasePreprocessProvider.ts` — remove Paddle-specific direct protocol details, but do not turn the legacy base contract into the primary async workflow surface.
- `src/main/knowledge/preprocess/PreprocessProvider.ts` — keep legacy wrapper aligned with any minimal cleanup that remains necessary.
- `src/main/knowledge/preprocess/PreprocessProviderFactory.ts` — keep Paddle provider wired only as a compatibility bridge while knowledge moves onto file-processing.
- `src/main/knowledge/preprocess/PaddleocrPreprocessProvider.ts` — reduce to compatibility-only logic or remove direct Paddle code entirely if knowledge switches fully to file-processing.
- `src/main/services/KnowledgeService.ts` — stop using inline Paddle preprocessing for the active async path and route Paddle-backed document work through the existing knowledge workflow + file-processing job chain.
- `src/main/services/fileProcessing/types.ts` — if needed, align handler outputs with explicit task-driven Paddle behavior.
- `src/main/services/fileProcessing/__tests__/FileProcessingOrchestrationService.integration.test.ts` — update expectations if Paddle mode wiring changes.
- `src/main/services/fileProcessing/tasks/__tests__/remotePollJobHandler.test.ts` — cover the new Paddle handler behavior if contracts change.
- `src/main/services/fileProcessing/processors/paddleocr/__tests__/utils.test.ts` — replace removed helper tests with service-backed behavior tests.
- `src/renderer/pages/settings/ComponentLabSettings/ComponentLabFileProcessingSettings.tsx` — if it references Paddle behavior assumptions, keep it aligned with the async model.
- `src/main/services/knowledge/__tests__/KnowledgeOrchestrationService.test.ts` / related knowledge job tests — add coverage for deferred preprocess continuation.

### Existing Supporting Files To Read During Execution

- `docs/superpowers/specs/2026-06-05-paddleocr-async-unification-design.md`
- `src/main/core/job/README.md`
- `src/main/services/fileProcessing/tasks/remotePollJobHandler.ts`
- `src/renderer/hooks/useJob.ts`
- `src/main/services/fileProcessing/FileProcessingOrchestrationService.ts`

## Task 1: Add shared async PaddleOCR task types

**Files:**
- Create: `src/shared/ocr/async.ts`
- Test: `src/shared/__tests__/ocr-async.test.ts`
- Modify: `src/renderer/types/ocr.ts`

- [ ] **Step 1: Write the failing shared type test**

```ts
import { describe, expect, it } from 'vitest'

import {
  OcrAsyncTaskResultSchema,
  OcrAsyncTaskStartResultSchema,
  OcrAsyncTaskStatusSchema
} from '../ocr/async'

describe('ocr async task schemas', () => {
  it('parses an OCR task start payload', () => {
    const result = OcrAsyncTaskStartResultSchema.parse({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      status: 'pending'
    })

    expect(result.taskId).toBe('job-1')
    expect(result.providerTaskId).toBe('paddle-1')
  })

  it('parses a completed OCR task result payload', () => {
    const result = OcrAsyncTaskResultSchema.parse({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      status: 'completed',
      progress: 100,
      result: {
        text: 'hello',
        pages: [{ text: 'hello' }]
      }
    })

    expect(result.result.text).toBe('hello')
  })

  it('rejects unknown status values', () => {
    expect(() =>
      OcrAsyncTaskStatusSchema.parse({
        taskId: 'job-1',
        providerTaskId: 'paddle-1',
        status: 'done',
        progress: 100
      })
    ).toThrow(/status/i)
  })
})
```

- [ ] **Step 2: Run the shared test to verify it fails**

Run: `pnpm test:shared -- src/shared/__tests__/ocr-async.test.ts`
Expected: FAIL because `src/shared/ocr/async.ts` does not exist yet.

- [ ] **Step 3: Add the new shared async OCR schemas and types**

```ts
import * as z from 'zod'

export const OcrAsyncTaskLifecycleStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed'])

export const OcrAsyncPageSchema = z.strictObject({
  text: z.string()
})

export const OcrAsyncTaskStartResultSchema = z.strictObject({
  taskId: z.string(),
  providerTaskId: z.string(),
  status: z.enum(['pending', 'processing'])
})

export const OcrAsyncTaskStatusSchema = z.strictObject({
  taskId: z.string(),
  providerTaskId: z.string(),
  status: OcrAsyncTaskLifecycleStatusSchema,
  progress: z.number().min(0).max(100)
})

export const OcrAsyncTaskResultSchema = z.strictObject({
  taskId: z.string(),
  providerTaskId: z.string(),
  status: z.literal('completed'),
  progress: z.literal(100),
  result: z.strictObject({
    text: z.string(),
    pages: z.array(OcrAsyncPageSchema)
  })
})

export type OcrAsyncTaskStartResult = z.infer<typeof OcrAsyncTaskStartResultSchema>
export type OcrAsyncTaskStatus = z.infer<typeof OcrAsyncTaskStatusSchema>
export type OcrAsyncTaskResult = z.infer<typeof OcrAsyncTaskResultSchema>
```

- [ ] **Step 4: Update renderer OCR types to use the new async types**

```ts
import type {
  OcrAsyncTaskResult,
  OcrAsyncTaskStartResult,
  OcrAsyncTaskStatus
} from '@shared/ocr/async'

export type OcrResult = {
  text: string
}

export type OcrTaskStartResult = OcrAsyncTaskStartResult
export type OcrTaskStatus = OcrAsyncTaskStatus
export type OcrTaskResult = OcrAsyncTaskResult
```

- [ ] **Step 5: Run the shared test to verify it passes**

Run: `pnpm test:shared -- src/shared/__tests__/ocr-async.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ocr/async.ts src/shared/__tests__/ocr-async.test.ts src/renderer/types/ocr.ts
git commit --signoff -m "feat(ocr-types): add async paddle task contracts"
```

## Task 2: Add the main-process PaddleOCR SDK service

**Files:**
- Create: `src/main/services/paddleocr/PaddleOcrSdkService.ts`
- Test: `src/main/services/paddleocr/__tests__/PaddleOcrSdkService.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing service test for task/result mapping**

```ts
import { describe, expect, it, vi } from 'vitest'

import { PaddleOcrSdkService } from '../PaddleOcrSdkService'

describe('PaddleOcrSdkService', () => {
  it('maps OCR SDK start output into project task metadata', async () => {
    const sdk = {
      submitOcr: vi.fn().mockResolvedValue({ jobId: 'paddle-1' })
    }

    const service = new PaddleOcrSdkService(sdk as never)

    const task = await service.startImageOcr({
      taskId: 'job-1',
      token: 'token',
      baseUrl: 'https://service.example',
      filePath: '/tmp/a.png'
    })

    expect(task).toEqual({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      status: 'pending'
    })
  })

  it('maps completed OCR SDK results into text + pages', async () => {
    const sdk = {
      getStatus: vi.fn().mockResolvedValue({ state: 'done' }),
      waitOcrResult: vi.fn().mockResolvedValue({
        jobId: 'paddle-1',
        pages: [{ prunedResult: { rec_texts: ['line 1', 'line 2'] } }]
      })
    }

    const service = new PaddleOcrSdkService(sdk as never)

    const result = await service.getImageOcrResult({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      token: 'token',
      baseUrl: 'https://service.example'
    })

    expect(result.result.text).toBe('line 1\nline 2')
    expect(result.result.pages).toEqual([{ text: 'line 1\nline 2' }])
  })
})
```

- [ ] **Step 2: Run the main test to verify it fails**

Run: `pnpm test:main -- src/main/services/paddleocr/__tests__/PaddleOcrSdkService.test.ts`
Expected: FAIL because the service file does not exist yet.

- [ ] **Step 3: Add the PaddleOCR SDK dependency if missing**

```json
{
  "dependencies": {
    "@paddleocr/api-sdk": "0.1.0"
  }
}
```

- [ ] **Step 4: Implement the minimal SDK-backed service**

```ts
import { PaddleOCRClient } from '@paddleocr/api-sdk'
import { loggerService } from '@logger'
import type {
  OcrAsyncTaskResult,
  OcrAsyncTaskStartResult,
  OcrAsyncTaskStatus
} from '@shared/ocr/async'

const logger = loggerService.withContext('PaddleOcrSdkService')

export class PaddleOcrSdkService {
  constructor(private readonly clientFactory = (token: string, baseUrl?: string) => new PaddleOCRClient({ token, baseUrl })) {}

  async startImageOcr(input: {
    taskId: string
    token: string
    baseUrl?: string
    filePath: string
  }): Promise<OcrAsyncTaskStartResult> {
    const client = this.clientFactory(input.token, input.baseUrl)
    const job = await client.submitOcr({ filePath: input.filePath })
    return { taskId: input.taskId, providerTaskId: job.jobId, status: 'pending' }
  }

  async getImageOcrStatus(input: {
    taskId: string
    providerTaskId: string
    token: string
    baseUrl?: string
  }): Promise<OcrAsyncTaskStatus> {
    const client = this.clientFactory(input.token, input.baseUrl)
    const status = await client.getStatus(input.providerTaskId)
    return {
      taskId: input.taskId,
      providerTaskId: input.providerTaskId,
      status: status.state === 'done' ? 'completed' : status.state === 'failed' ? 'failed' : 'processing',
      progress: status.state === 'done' ? 100 : 0
    }
  }

  async getImageOcrResult(input: {
    taskId: string
    providerTaskId: string
    token: string
    baseUrl?: string
  }): Promise<OcrAsyncTaskResult> {
    const client = this.clientFactory(input.token, input.baseUrl)
    const sdkResult = await client.waitOcrResult({ jobId: input.providerTaskId })
    const pageTexts = sdkResult.pages.map((page) => (page.prunedResult?.rec_texts ?? []).join('\n'))
    return {
      taskId: input.taskId,
      providerTaskId: input.providerTaskId,
      status: 'completed',
      progress: 100,
      result: {
        text: pageTexts.join('\n\n').trim(),
        pages: pageTexts.map((text) => ({ text }))
      }
    }
  }
}

export const paddleOcrSdkService = new PaddleOcrSdkService()
```

- [ ] **Step 5: Run the main test to verify it passes**

Run: `pnpm test:main -- src/main/services/paddleocr/__tests__/PaddleOcrSdkService.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json src/main/services/paddleocr/PaddleOcrSdkService.ts src/main/services/paddleocr/__tests__/PaddleOcrSdkService.test.ts
git commit --signoff -m "feat(paddleocr): add async sdk service"
```

## Task 3: Convert file-processing Paddle handlers to the shared service

**Files:**
- Modify: `src/main/services/fileProcessing/processors/paddleocr/document-to-markdown/handler.ts`
- Modify: `src/main/services/fileProcessing/processors/paddleocr/image-to-text/handler.ts`
- Modify: `src/main/services/fileProcessing/processors/paddleocr/utils.ts`
- Modify: `src/main/services/fileProcessing/processors/registry.ts`
- Test: `src/main/services/fileProcessing/processors/paddleocr/__tests__/utils.test.ts`
- Test: `src/main/services/fileProcessing/tasks/__tests__/remotePollJobHandler.test.ts`

- [ ] **Step 1: Write the failing test for service-backed Paddle file-processing behavior**

```ts
import { describe, expect, it, vi } from 'vitest'

import { paddleDocumentToMarkdownHandler } from '../document-to-markdown/handler'
import { paddleOcrSdkService } from '../../../../paddleocr/PaddleOcrSdkService'

vi.mock('../../../../paddleocr/PaddleOcrSdkService', () => ({
  paddleOcrSdkService: {
    startDocumentParsing: vi.fn(),
    getDocumentParsingStatus: vi.fn(),
    getDocumentParsingResult: vi.fn()
  }
}))

describe('paddleDocumentToMarkdownHandler', () => {
  it('starts a remote task through the shared paddle service', async () => {
    vi.mocked(paddleOcrSdkService.startDocumentParsing).mockResolvedValue({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      status: 'pending'
    })

    const prepared = await paddleDocumentToMarkdownHandler.prepare(
      { path: '/tmp/a.pdf', type: 'document', ext: '.pdf', name: 'a', size: 1 },
      {} as never
    )

    expect(prepared.mode).toBe('remote-poll')
  })
})
```

- [ ] **Step 2: Run the targeted main test to verify it fails**

Run: `pnpm test:main -- src/main/services/fileProcessing/processors/paddleocr/__tests__/utils.test.ts src/main/services/fileProcessing/tasks/__tests__/remotePollJobHandler.test.ts`
Expected: FAIL because the handlers still depend on direct Paddle helper functions.

- [ ] **Step 3: Replace direct helper usage in the document handler**

```ts
import { paddleOcrSdkService } from '@main/services/paddleocr/PaddleOcrSdkService'

export const paddleDocumentToMarkdownHandler = {
  mode: 'remote-poll',
  prepare(file, config) {
    const context = prepareStartContext(file, config)

    return {
      mode: 'remote-poll',
      async startRemote() {
        const task = await paddleOcrSdkService.startDocumentParsing({
          taskId: 'filled-by-job-manager-later',
          token: context.apiKey,
          baseUrl: context.apiHost,
          filePath: file.path,
          model: context.model
        })

        return {
          providerTaskId: task.providerTaskId,
          status: task.status,
          progress: 0,
          remoteContext: { apiHost: context.apiHost }
        }
      },
      async pollRemote(task) {
        return await paddleOcrSdkService.getDocumentParsingPollResult({
          providerTaskId: task.providerTaskId,
          token: context.apiKey,
          baseUrl: task.remoteContext.apiHost
        })
      },
      toPersistable(remoteContext, providerTaskId) {
        return { providerTaskId, apiHost: remoteContext.apiHost }
      },
      rehydrate(persisted, restoredConfig) {
        return {
          providerTaskId: persisted.providerTaskId,
          remoteContext: {
            apiHost: persisted.apiHost!,
            apiKey: getRequiredApiKey(restoredConfig, 'paddleocr')
          }
        }
      }
    }
  }
} as const
```

- [ ] **Step 4: Replace direct helper usage in the image handler**

```ts
import { paddleOcrSdkService } from '@main/services/paddleocr/PaddleOcrSdkService'

export const paddleImageToTextHandler = {
  mode: 'remote-poll',
  prepare(file, config) {
    const context = prepareStartContext(file, config)

    return {
      mode: 'remote-poll',
      async startRemote() {
        const task = await paddleOcrSdkService.startImageOcr({
          taskId: 'filled-by-job-manager-later',
          token: context.apiKey,
          baseUrl: context.apiHost,
          filePath: file.path
        })

        return {
          providerTaskId: task.providerTaskId,
          status: task.status,
          progress: 0,
          remoteContext: { apiHost: context.apiHost }
        }
      },
      async pollRemote(task) {
        return await paddleOcrSdkService.getImageOcrPollResult({
          providerTaskId: task.providerTaskId,
          token: context.apiKey,
          baseUrl: task.remoteContext.apiHost
        })
      },
      toPersistable(remoteContext, providerTaskId) {
        return { providerTaskId, apiHost: remoteContext.apiHost }
      },
      rehydrate(persisted, restoredConfig) {
        return {
          providerTaskId: persisted.providerTaskId,
          remoteContext: {
            apiHost: persisted.apiHost!,
            apiKey: getRequiredApiKey(restoredConfig, 'paddleocr')
          }
        }
      }
    }
  }
} as const
```

- [ ] **Step 5: Delete obsolete direct Paddle helper code**

```ts
// Remove createJob / getJobResult / waitForJobCompletion / resolveJsonlResult
// Keep this file only if non-Paddle-neutral helpers remain; otherwise delete it
export {}
```

- [ ] **Step 6: Run the targeted main tests to verify they pass**

Run: `pnpm test:main -- src/main/services/fileProcessing/processors/paddleocr/__tests__/utils.test.ts src/main/services/fileProcessing/tasks/__tests__/remotePollJobHandler.test.ts`
Expected: PASS with Paddle handlers using remote-poll semantics via the shared service.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/fileProcessing/processors/paddleocr/document-to-markdown/handler.ts src/main/services/fileProcessing/processors/paddleocr/image-to-text/handler.ts src/main/services/fileProcessing/processors/paddleocr/utils.ts src/main/services/fileProcessing/processors/registry.ts src/main/services/fileProcessing/tasks/__tests__/remotePollJobHandler.test.ts src/main/services/fileProcessing/processors/paddleocr/__tests__/utils.test.ts
git commit --signoff -m "refactor(file-processing): route paddle handlers through async sdk service"
```

## Task 4: Replace one-shot OCR IPC with task-based OCR IPC

**Files:**
- Modify: `src/shared/IpcChannel.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/services/ocr/OcrService.ts`
- Modify: `src/main/services/ocr/builtin/PpocrService.ts`
- Test: `src/main/services/ocr/__tests__/OcrService.test.ts`

- [ ] **Step 1: Write the failing OCR main service test for start/status/result IPC**

```ts
import { describe, expect, it, vi } from 'vitest'

import { OcrService } from '../OcrService'

describe('OcrService paddle async bridge', () => {
  it('delegates startOcrTask to the paddle handler', async () => {
    const paddleHandler = {
      startTask: vi.fn().mockResolvedValue({ taskId: 'job-1', providerTaskId: 'paddle-1', status: 'pending' })
    }

    const service = new OcrService()
    service.register('paddleocr', paddleHandler as never)

    const result = await service.startTask({ path: '/tmp/a.png' } as never, { id: 'paddleocr' } as never)
    expect(result.providerTaskId).toBe('paddle-1')
  })
})
```

- [ ] **Step 2: Run the targeted main test to verify it fails**

Run: `pnpm test:main -- src/main/services/ocr/__tests__/OcrService.test.ts`
Expected: FAIL because `startTask` / status / result APIs do not exist yet.

- [ ] **Step 3: Add new OCR IPC channels**

```ts
OCR_Start = 'ocr:start'
OCR_GetStatus = 'ocr:get-status'
OCR_GetResult = 'ocr:get-result'
OCR_ListProviders = 'ocr:list-providers'
```

- [ ] **Step 4: Expose task-based preload APIs**

```ts
ocr: {
  start: (file: SupportedOcrFile, provider: OcrProvider) => ipcRenderer.invoke(IpcChannel.OCR_Start, file, provider),
  getStatus: (taskId: string, provider: OcrProvider) => ipcRenderer.invoke(IpcChannel.OCR_GetStatus, taskId, provider),
  getResult: (taskId: string, provider: OcrProvider) => ipcRenderer.invoke(IpcChannel.OCR_GetResult, taskId, provider),
  listProviders: () => ipcRenderer.invoke(IpcChannel.OCR_ListProviders)
}
```

- [ ] **Step 5: Change the main OCR service and Paddle provider to task APIs**

```ts
public async startTask(file: SupportedOcrFile, provider: OcrProvider): Promise<OcrTaskStartResult> {
  const handler = this.registry.get(provider.id)
  if (!handler?.startTask) throw new Error(`Provider ${provider.id} does not support async OCR tasks`)
  return handler.startTask(file, provider.config)
}

public async getTaskResult(taskId: string, provider: OcrProvider): Promise<OcrTaskResult> {
  const handler = this.registry.get(provider.id)
  if (!handler?.getTaskResult) throw new Error(`Provider ${provider.id} does not support async OCR tasks`)
  return handler.getTaskResult(taskId, provider.config)
}
```

```ts
export class PpocrService extends OcrBaseService {
  async startTask(file: SupportedOcrFile, options?: OcrPpocrConfig) {
    return await paddleOcrSdkService.startImageOcr({
      taskId: crypto.randomUUID(),
      token: options?.accessToken ?? '',
      baseUrl: options?.apiUrl,
      filePath: file.path
    })
  }

  async getTaskResult(taskId: string, options?: OcrPpocrConfig) {
    return await paddleOcrSdkService.getImageOcrResult({
      taskId,
      providerTaskId: taskId,
      token: options?.accessToken ?? '',
      baseUrl: options?.apiUrl
    })
  }
}
```

- [ ] **Step 6: Run the targeted main test to verify it passes**

Run: `pnpm test:main -- src/main/services/ocr/__tests__/OcrService.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/IpcChannel.ts src/preload/index.ts src/main/services/ocr/OcrService.ts src/main/services/ocr/builtin/PpocrService.ts src/main/services/ocr/__tests__/OcrService.test.ts
git commit --signoff -m "feat(ocr-service): switch paddleocr ipc to async tasks"
```

## Task 5: Update renderer OCR service, hook, and translate page to observe jobs

**Files:**
- Modify: `src/renderer/services/ocr/OcrService.ts`
- Modify: `src/renderer/hooks/useOcr.ts`
- Modify: `src/renderer/pages/translate/TranslatePage.tsx`
- Test: `src/renderer/pages/translate/__tests__/TranslatePage.test.tsx`
- Test: `src/renderer/hooks/__tests__/useOcr.test.ts`

- [ ] **Step 1: Write the failing renderer hook test for task startup behavior**

```ts
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useOcr } from '../useOcr'

vi.mock('@renderer/services/ocr/OcrService', () => ({
  start: vi.fn().mockResolvedValue({ taskId: 'job-1', providerTaskId: 'paddle-1', status: 'pending' })
}))

describe('useOcr', () => {
  it('starts an OCR task instead of awaiting final text', async () => {
    const { result } = renderHook(() => useOcr())
    const task = await result.current.startOcr({ path: '/tmp/a.png', type: 'image' } as never)
    expect(task.taskId).toBe('job-1')
  })
})
```

- [ ] **Step 2: Run the targeted renderer test to verify it fails**

Run: `pnpm test:renderer -- src/renderer/hooks/__tests__/useOcr.test.ts src/renderer/pages/translate/__tests__/TranslatePage.test.tsx`
Expected: FAIL because `useOcr` still returns a one-shot `ocr()` helper.

- [ ] **Step 3: Refactor the renderer OCR service to start/get tasks**

```ts
export const start = async (file: SupportedOcrFile, provider: OcrProvider): Promise<OcrTaskStartResult> => {
  if (isOcrApiProvider(provider)) {
    throw new Error('API OCR providers are not yet supported by the async task bridge')
  }
  return window.api.ocr.start(file, provider)
}

export const getResult = async (taskId: string, provider: OcrProvider): Promise<OcrTaskResult> => {
  return window.api.ocr.getResult(taskId, provider)
}
```

- [ ] **Step 4: Refactor `useOcr` to start tasks and expose task helpers**

```ts
export const useOcr = () => {
  const { imageProvider } = useOcrProviders()

  const startOcr = useCallback(async (file: SupportedOcrFile) => {
    return await OcrService.start(file, imageProvider)
  }, [imageProvider])

  return {
    startOcr,
    provider: imageProvider
  }
}
```

- [ ] **Step 5: Update translate page to observe the OCR job and fetch the result**

```ts
const { startOcr, provider } = useOcr()
const [ocrJobId, setOcrJobId] = useState<string | null>(null)
const { data: ocrJob, isTerminal } = useJob(ocrJobId ?? '')

const onDropFile = useCallback(async (file: SupportedOcrFile) => {
  setIsProcessing(true)
  const task = await startOcr(file)
  setOcrJobId(task.taskId)
}, [startOcr])

useEffect(() => {
  if (!ocrJobId || !ocrJob || !isTerminal || ocrJob.status !== 'completed') return

  void OcrService.getResult(ocrJobId, provider).then((result) => {
    setTranslateInputValue(result.result.text)
    setIsProcessing(false)
  })
}, [ocrJob, ocrJobId, isTerminal, provider, setTranslateInputValue])
```

- [ ] **Step 6: Run the targeted renderer tests to verify they pass**

Run: `pnpm test:renderer -- src/renderer/hooks/__tests__/useOcr.test.ts src/renderer/pages/translate/__tests__/TranslatePage.test.tsx`
Expected: PASS with translate flow waiting on a job instead of a single OCR promise.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/services/ocr/OcrService.ts src/renderer/hooks/useOcr.ts src/renderer/pages/translate/TranslatePage.tsx src/renderer/hooks/__tests__/useOcr.test.ts src/renderer/pages/translate/__tests__/TranslatePage.test.tsx
git commit --signoff -m "feat(translate): observe paddleocr jobs in renderer"
```

## Task 6: Route Paddle-backed knowledge document processing through the existing knowledge workflow

**Files:**
- Modify: `src/main/services/knowledge/utils/sources/sourcePlanning.ts`
- Modify: `src/main/services/knowledge/KnowledgeWorkflowService.ts`
- Modify: `src/main/services/knowledge/jobs/checkFileProcessingResultJobHandler.ts`
- Modify: `src/main/services/KnowledgeService.ts`
- Modify: `src/main/knowledge/preprocess/PaddleocrPreprocessProvider.ts`
- Modify: `src/main/knowledge/preprocess/BasePreprocessProvider.ts`
- Modify: `src/main/knowledge/preprocess/PreprocessProvider.ts`
- Modify: `src/main/knowledge/preprocess/PreprocessProviderFactory.ts`
- Test: `src/main/services/knowledge/__tests__/KnowledgeOrchestrationService.test.ts`
- Test: `src/main/services/knowledge/jobs/__tests__/checkFileProcessingResultJobHandler.test.ts`

- [ ] **Step 1: Write the failing knowledge workflow test for Paddle PDF routing**

```ts
import { describe, expect, it } from 'vitest'

describe('KnowledgeWorkflowService paddle pdf routing', () => {
  it('routes paddle-backed PDF items through file-processing instead of inline KnowledgeService preprocessing', async () => {
    await workflowService.scheduleItem('kb-1' as never, 'file-1' as never)

    expect(fileProcessingService.startJob).toHaveBeenCalledWith(
      {
        feature: 'document_to_markdown',
        fileEntryId: FILE_ENTRY_ID,
        processorId: 'paddleocr'
      },
      expect.any(Object)
    )
  })
})
```

- [ ] **Step 2: Run the targeted main tests to verify they fail**

Run: `pnpm test:main -- src/main/services/knowledge/__tests__/KnowledgeOrchestrationService.test.ts src/main/services/knowledge/jobs/__tests__/checkFileProcessingResultJobHandler.test.ts`
Expected: FAIL because the active knowledge workflow path does not yet force Paddle PDFs onto file-processing.

- [ ] **Step 3: Make source planning and workflow scheduling always use file-processing for Paddle-backed document parsing**

```ts
if (plan.kind === 'needsFileProcessing') {
  if (item.type !== 'file') {
    throw new Error(`File processing source plan produced for non-file item: ${item.id}`)
  }

  const processorId = FileProcessorIdSchema.parse(base.fileProcessorId)
  const fileProcessing = application.get('FileProcessingOrchestrationService')
  const fileProcessingJob = await fileProcessing.startJob(
    {
      feature: 'document_to_markdown',
      fileEntryId: item.data.fileEntryId,
      processorId
    },
    {
      parentId: parentJobId ?? undefined
    }
  )

  await this.scheduleFileProcessingCheck(baseId, itemId, fileProcessingJob.id, item.data.fileEntryId, {
    pollRound: 0,
    firstScheduledAt: Date.now(),
    parentJobId: parentJobId ?? fileProcessingJob.id
  })
  return
}
```

- [ ] **Step 4: Update the file-processing completion job test to assert Paddle output continues into indexing**

```ts
it('replaces the source file ref and schedules indexing after paddle file-processing completes', async () => {
  getJobMock.mockResolvedValue(
    createFileProcessingJobSnapshot({
      status: 'completed',
      input: {
        feature: 'document_to_markdown',
        fileEntryId: FILE_ENTRY_ID,
        processorId: 'paddleocr'
      },
      output: {
        artifact: { kind: 'file', format: 'markdown', fileEntryId: PROCESSED_FILE_ENTRY_ID }
      }
    })
  )

  await handler.execute(createCtx(createCheckPayload()))

  expect(knowledgeItemReplaceFileRefMock).toHaveBeenCalledWith(
    FILE_ITEM_ID,
    PROCESSED_FILE_ENTRY_ID,
    'processed_artifact'
  )
  expect(workflowService.scheduleIndexing).toHaveBeenCalled()
})
```

- [ ] **Step 5: Remove the active-path dependency on inline Paddle preprocessing in legacy KnowledgeService**

```ts
if (base.preprocessProvider?.provider.id === 'paddleocr') {
  logger.info('Skipping legacy inline PaddleOCR preprocessing; active path is file-processing workflow', {
    itemId: item.id,
    baseId: base.id,
    fileId: file.id
  })
  return file
}
```

Apply the same task to reduce `PaddleocrPreprocessProvider.ts` to compatibility-only code or delete its direct Paddle request/response handling entirely if no active call path remains.

- [ ] **Step 6: Run the targeted main tests to verify they pass**

Run: `pnpm test:main -- src/main/services/knowledge/__tests__/KnowledgeOrchestrationService.test.ts src/main/services/knowledge/jobs/__tests__/checkFileProcessingResultJobHandler.test.ts`
Expected: PASS with Paddle-backed knowledge PDFs fully driven by file-processing jobs and follow-up indexing.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/knowledge/utils/sources/sourcePlanning.ts src/main/services/knowledge/KnowledgeWorkflowService.ts src/main/services/knowledge/jobs/checkFileProcessingResultJobHandler.ts src/main/services/KnowledgeService.ts src/main/knowledge/preprocess/PaddleocrPreprocessProvider.ts src/main/knowledge/preprocess/BasePreprocessProvider.ts src/main/knowledge/preprocess/PreprocessProvider.ts src/main/knowledge/preprocess/PreprocessProviderFactory.ts src/main/services/knowledge/__tests__/KnowledgeOrchestrationService.test.ts src/main/services/knowledge/jobs/__tests__/checkFileProcessingResultJobHandler.test.ts
git commit --signoff -m "refactor(knowledge): route paddle documents through async workflow"
```

## Task 7: Remove obsolete Paddle direct protocol code and run verification

**Files:**
- Modify: `src/main/services/ocr/builtin/PpocrService.ts`
- Modify: `src/main/knowledge/preprocess/PaddleocrPreprocessProvider.ts`
- Modify: `src/main/services/fileProcessing/processors/paddleocr/utils.ts`
- Modify: any leftover Paddle direct-response schema/helper files discovered during execution

- [ ] **Step 1: Write the failing regression grep check as a local verification step**

```bash
grep -Rni "layoutParsingResults\|ocrResults\|/api/v2/ocr/jobs\|jsonUrl\|waitForJobCompletion\|createJob" src/main/services src/main/knowledge
```

Expected: non-empty output before cleanup, proving obsolete direct Paddle protocol references still exist.

- [ ] **Step 2: Delete leftover direct Paddle response parsing and endpoint wiring**

```ts
// Remove zod schemas and helper functions dedicated to raw Paddle HTTP payloads.
// Keep only thin config validation or filesystem helpers that remain necessary
// after all requests/status/result handling moves into PaddleOcrSdkService.
```

- [ ] **Step 3: Run the grep verification to confirm cleanup**

Run: `grep -Rni "layoutParsingResults\|ocrResults\|/api/v2/ocr/jobs\|jsonUrl\|waitForJobCompletion\|createJob" src/main/services src/main/knowledge`
Expected: no matches in Paddle-owned business code, or only references inside the new centralized SDK service if unavoidable.

- [ ] **Step 4: Run targeted test suites**

Run: `pnpm test:main -- src/main/services/paddleocr/__tests__/PaddleOcrSdkService.test.ts src/main/services/fileProcessing/tasks/__tests__/remotePollJobHandler.test.ts src/main/services/knowledge/__tests__/KnowledgeOrchestrationService.test.ts`
Expected: PASS.

- [ ] **Step 5: Run renderer tests**

Run: `pnpm test:renderer -- src/renderer/hooks/__tests__/useOcr.test.ts src/renderer/pages/translate/__tests__/TranslatePage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run full required verification**

Run: `pnpm lint && pnpm test && pnpm format`
Expected: all commands succeed.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/ocr/builtin/PpocrService.ts src/main/knowledge/preprocess/PaddleocrPreprocessProvider.ts src/main/services/fileProcessing/processors/paddleocr/utils.ts
git commit --signoff -m "refactor(paddleocr): remove legacy direct protocol code"
```

## Task 8: Final integration sweep and documentation sanity check

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-paddleocr-async-unification-design.md` (only if implementation differs materially)
- Modify: any touched tests or type definitions needed to keep the tree consistent

- [ ] **Step 1: Write the failing docs/link sanity check command**

Run: `pnpm docs:check-links`
Expected: fix any broken links introduced by moved/added shared OCR docs or plan/spec references.

- [ ] **Step 2: Reconcile plan-vs-code naming mismatches**

```ts
// Check that all final exported names match the implementation:
// PaddleOcrSdkService, startImageOcr, getImageOcrStatus, getImageOcrResult,
// startDocumentParsing, getDocumentParsingStatus, getDocumentParsingResult.
```

- [ ] **Step 3: Run the basic CI subset one last time**

Run: `pnpm openapi:check && pnpm docs:check-links && pnpm test:main && pnpm test:renderer`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-05-paddleocr-async-unification-design.md src/shared/ocr/async.ts src/renderer/types/ocr.ts
git commit --signoff -m "chore(paddleocr): finalize async integration sweep"
```

## Self-Review Notes

- Spec coverage: this plan covers shared async contracts, centralized SDK service, file-processing unification, OCR IPC + renderer migration, and knowledge preprocess split.
- Placeholder scan: direct placeholders removed; SDK version and knowledge workflow continuation are now pinned to concrete repo structures.
- Type consistency: all tasks use the same `start/status/result` model and the same `PaddleOcrSdkService` naming.
