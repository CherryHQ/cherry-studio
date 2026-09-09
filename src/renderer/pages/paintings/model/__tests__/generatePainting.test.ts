import type { FileMetadata } from '@renderer/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runPaintingMock = vi.fn(async (generate: () => Promise<unknown>) => {
  await generate()
  return [] as FileMetadata[]
})

vi.mock('../runPainting', () => ({
  runPainting: (generate: () => Promise<unknown>) => runPaintingMock(generate)
}))

// Image generation goes through ipcApi.request('ai.image.generate', { requestId, payload }).
const { ipcRequestMock } = vi.hoisted(() => ({ ipcRequestMock: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequestMock } }))

import type { GeneratePaintingOptions } from '../generatePainting'
import { generatePainting } from '../generatePainting'

function makeOptions(
  paramValues: Record<string, unknown> = {},
  signal: AbortSignal = new AbortController().signal
): GeneratePaintingOptions {
  return {
    provider: {
      id: 'aihubmix',
      name: 'AiHubMix',
      apiHost: 'https://aihubmix.com',
      isEnabled: true,
      getApiKey: async () => 'sk'
    },
    signal,
    modelId: 'gpt-image-1',
    prompt: 'a fox',
    paramValues
  }
}

describe('generatePainting', () => {
  beforeEach(() => {
    runPaintingMock.mockClear()
    ipcRequestMock.mockReset()
    ipcRequestMock.mockImplementation(async (route: string) =>
      route === 'ai.image.generate' ? { files: [] } : undefined
    )
  })

  // The image payload now rides in the second arg as `{ requestId, payload }`.
  const imagePayload = (): Record<string, unknown> => {
    const call = ipcRequestMock.mock.calls.find(([route]) => route === 'ai.image.generate')
    if (!call) throw new Error('ai.image.generate was not requested')
    return (call[1] as { payload: Record<string, unknown> }).payload
  }

  it('sends the canonical paramValues bag in the IPC payload (main owns the wire mapping)', async () => {
    await generatePainting(makeOptions({ size: 'auto', numImages: 2 }))

    expect(imagePayload()).toMatchObject({
      uniqueModelId: 'aihubmix::gpt-image-1',
      prompt: 'a fox',
      paramValues: { size: 'auto', numImages: 2 }
    })
  })

  it("stamps painting outputs as 'delete_when_unreferenced' (reaped once no painting references them)", async () => {
    // Value-locks the policy: TS already blocks omitting cleanupPolicy, but not
    // flipping it to 'manual', which would leak painting images forever.
    await generatePainting(makeOptions({ size: '1024x1024' }))
    expect(imagePayload()).toMatchObject({ cleanupPolicy: 'delete_when_unreferenced' })
  })

  it('passes paramValues verbatim — no top-level wire fields', async () => {
    await generatePainting(makeOptions({ size: '1024x1024' }))

    const payload = imagePayload()
    expect((payload as { paramValues: Record<string, unknown> }).paramValues).toEqual({ size: '1024x1024' })
    expect(payload).not.toHaveProperty('size')
  })

  // The pipeline awaits model-support prefetch, provider checks and input-image reads before
  // reaching generatePainting. An abort during those must not fire the billable request.
  it('never requests ai.image.generate when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(generatePainting(makeOptions({}, controller.signal))).rejects.toMatchObject({ name: 'AbortError' })
    expect(ipcRequestMock).not.toHaveBeenCalled()
  })

  // A provider failure now crosses IpcApi as an IpcError (name 'IpcError'), which no longer
  // satisfies runPainting's `name === 'AbortError'` silent-cancel check — generatePainting's
  // `.catch` re-derives a real AbortError only when the user aborted, else re-throws the original.
  it('re-throws a real AbortError when the request rejects after the user aborted', async () => {
    const controller = new AbortController()
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'ai.image.generate') {
        controller.abort()
        throw new Error('cancelled by main')
      }
      return undefined
    })

    await expect(generatePainting(makeOptions({}, controller.signal))).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('waits for the cancelled request and rejects a result that arrives after abort', async () => {
    const controller = new AbortController()
    const generation = Promise.withResolvers<{ files: [] }>()
    ipcRequestMock.mockImplementation((route: string) =>
      route === 'ai.image.generate' ? generation.promise : Promise.resolve()
    )
    let settled = false
    const outcome = generatePainting(makeOptions({}, controller.signal)).then(
      (value) => {
        settled = true
        return value
      },
      (error: unknown) => {
        settled = true
        return error
      }
    )
    const requestId = ipcRequestMock.mock.calls.find(([route]) => route === 'ai.image.generate')?.[1].requestId
    expect(requestId).toBeTypeOf('string')

    controller.abort()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    expect(ipcRequestMock).toHaveBeenCalledWith('ai.image.abort', { requestId })

    generation.resolve({ files: [] })
    expect(await outcome).toMatchObject({ name: 'AbortError', message: 'Image generation aborted' })
  })

  it('detaches cancellation after the generate request settles', async () => {
    const controller = new AbortController()
    await generatePainting(makeOptions({}, controller.signal))

    controller.abort()

    expect(ipcRequestMock).not.toHaveBeenCalledWith('ai.image.abort', expect.anything())
  })

  it('re-throws the original error when the request rejects without a user abort', async () => {
    const failure = new Error('provider exploded')
    ipcRequestMock.mockImplementation(async (route: string) => {
      if (route === 'ai.image.generate') throw failure
      return undefined
    })

    await expect(generatePainting(makeOptions({}))).rejects.toBe(failure)
  })
})
