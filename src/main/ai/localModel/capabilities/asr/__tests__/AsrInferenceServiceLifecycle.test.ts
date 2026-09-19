import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const managerRef = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) =>
    name === 'UtilityProcessManager' ? managerRef.current : originalGet(name)
  )
  return result
})

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn(), getPath: vi.fn(() => '/mock/path'), isPackaged: false, setAppLogsPath: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() },
  utilityProcess: { fork: vi.fn() },
  MessageChannelMain: vi.fn()
}))

vi.mock('../modelPaths', () => ({
  resolveAsrModelPaths: () => ({
    encoder: '/models/encoder.onnx',
    llm: '/models/llm.onnx',
    embedding: '/models/embedding.onnx',
    tokenizerDir: '/models/tokenizer',
    voiceActivityDetector: '/models/vad.onnx'
  })
}))

import { BaseService } from '@main/core/lifecycle'
import { createRecordingLogger } from '@main/core/utilityProcess/__tests__/hostTestUtils'
import {
  createMemoryProcessAdapter,
  flushMicrotasks,
  waitUntil
} from '@main/core/utilityProcess/__tests__/memoryProcessAdapter'
import { UtilityProcessManager } from '@main/core/utilityProcess/UtilityProcessManager'

import type { AsrInferenceContract } from '../../../runtime/inferenceProcess'
import type { InferenceInitData } from '../../../runtime/protocol'
import { AsrInferenceService } from '../AsrInferenceService'

const RESULT = { text: 'test transcript', segments: [{ text: 'test transcript', start: 0, end: 1 }] }
const SOURCE = { kind: 'wav' as const, filePath: '/recording.wav' }
const BLOCKED_SOURCE = { kind: 'wav' as const, filePath: '/blocked.wav' }

let manager: UtilityProcessManager
let adapter: ReturnType<typeof createMemoryProcessAdapter>
let blocked: ReturnType<typeof Promise.withResolvers<typeof RESULT>>
let received: string[]

beforeEach(() => {
  BaseService.resetInstances()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.local_model.hardware_acceleration.enabled', false)
  blocked = Promise.withResolvers<typeof RESULT>()
  received = []
})

afterEach(async () => {
  blocked.resolve(RESULT)
  for (const { child } of adapter?.spawns ?? []) child.exit(0)
  await manager?._doStop()
  managerRef.current = null
})

async function createService(): Promise<AsrInferenceService> {
  adapter = createMemoryProcessAdapter((child) => {
    child.serve<AsrInferenceContract, InferenceInitData>({
      id: 'inference.asr',
      handlers: {
        transcribe: ({ source }) => {
          if (source.kind !== 'wav') throw new Error('This fixture accepts WAV sources')
          received.push(source.filePath)
          return source.filePath === BLOCKED_SOURCE.filePath ? blocked.promise : RESULT
        }
      }
    })
  })
  manager = new UtilityProcessManager({
    adapter,
    logger: createRecordingLogger(),
    resolveEntry: (entry) => `/out/${entry}.js`,
    getTempDir: () => '/tmp/cherry-test'
  })
  await manager._doInit()
  managerRef.current = manager
  const service = new AsrInferenceService()
  await service._doInit()
  return service
}

describe('ASR service lifecycle', () => {
  it.each(['_doStop', '_doDestroy'] as const)('%s cancels active and queued work without respawning', async (stop) => {
    const service = await createService()
    const active = service.transcribe(BLOCKED_SOURCE).then(
      () => 'resolved',
      () => 'rejected'
    )
    const queued = service.transcribe(SOURCE).then(
      () => 'resolved',
      () => 'rejected'
    )
    await waitUntil(() => received.length === 1, 'active transcription')

    await service[stop]()
    await flushMicrotasks()

    expect(adapter.spawns[0].child.exited).toBe(true)
    expect(await active).toBe('rejected')
    expect(await queued).toBe('rejected')
    expect(received).toEqual([BLOCKED_SOURCE.filePath])
    expect(adapter.spawns).toHaveLength(1)
    expect(manager.isReady).toBe(true)
  })

  it('rejects new work after stopping while the process manager is still running', async () => {
    const service = await createService()
    await service._doStop()

    await expect(service.transcribe(SOURCE)).rejects.toThrow(/not running/i)
    expect(adapter.spawns).toHaveLength(0)
  })

  it('starts a fresh inference process after the service restarts', async () => {
    const service = await createService()
    await expect(service.transcribe(SOURCE)).resolves.toEqual(RESULT)

    await service._doStop()
    expect(adapter.spawns[0].child.exited).toBe(true)
    await service._doInit()

    await expect(service.transcribe(SOURCE)).resolves.toEqual(RESULT)
    expect(adapter.spawns).toHaveLength(2)
  })

  it('preserves caller cancellation without cancelling the next request', async () => {
    const service = await createService()
    const controller = new AbortController()
    const reason = new Error('caller cancelled transcription')
    const active = service.transcribe(BLOCKED_SOURCE, controller.signal).catch((error: unknown) => error)
    await waitUntil(() => received.length === 1, 'active transcription')

    controller.abort(reason)

    expect(await active).toBe(reason)
    expect(adapter.spawns[0].child.exited).toBe(true)
    await expect(service.transcribe(SOURCE)).resolves.toEqual(RESULT)
    expect(adapter.spawns).toHaveLength(2)
  })
})
