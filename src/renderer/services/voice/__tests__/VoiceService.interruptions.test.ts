import { expect, it, vi } from 'vitest'

import type { VoiceSessionEvent } from '@shared/ipc/schemas/voice'

import { VoiceService } from '../VoiceService'

it('delivers interruption while initialization has no admitted session and detaches after teardown', async () => {
  let emit!: (event: VoiceSessionEvent) => void
  let resolve!: (value: { phase: 'idle'; revision: number }) => void
  const service = new VoiceService({
    ipc: {
      request: vi.fn(() => new Promise<any>((done) => (resolve = done))),
      on: (_event, callback) => {
        emit = callback
        return () => undefined
      }
    },
    ownerWindow: new EventTarget() as Window
  })
  let interrupted = false
  service.subscribeInterruptions(() => {
    interrupted = true
  })
  const initializing = service.initialize()

  emit({ type: 'interruption', revision: 1 })

  expect(interrupted).toBe(true)
  expect(service.getSnapshot()).toEqual({ phase: 'idle', revision: 0 })
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  resolve({ phase: 'idle', revision: 1 })
  await initializing
  await service.teardown()
  interrupted = false
  emit({ type: 'interruption', revision: 2 })
  expect(interrupted).toBe(false)
})

it('delivers a recording interruption when Main publishes ownership before the admission response', async () => {
  const sessionId = '00000000-0000-4000-8000-000000000001'
  let emit!: (event: VoiceSessionEvent) => void
  let resolve!: (value: { phase: 'recording'; revision: number; sessionId: string }) => void
  const request = vi.fn()
  request.mockImplementation(async (route: string) => {
    if (route === 'ai.voice.session.state') return { phase: 'idle', revision: 1 }
    if (route === 'ai.voice.recording.start') return new Promise((done) => (resolve = done))
    if (route === 'ai.voice.session.discard') return undefined
    throw new Error(`Unexpected route: ${route}`)
  })
  const service = new VoiceService({
    ipc: {
      request,
      on: (_event, callback) => {
        emit = callback
        return () => undefined
      }
    },
    ownerWindow: new EventTarget() as Window
  })
  const commands: string[] = []
  service.subscribeCommands(({ command }) => commands.push(command))
  await service.initialize()
  const recording = service.startRecording({ sessionId })
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))

  emit({ type: 'state', phase: 'recording', revision: 2, sessionId })
  emit({ type: 'interruption', revision: 3 })
  emit({ type: 'command', command: 'interrupt', revision: 3, sessionId })

  expect(commands).toEqual(['interrupt'])
  resolve({ phase: 'recording', revision: 2, sessionId })
  await recording.result
  await service.teardown()
})
