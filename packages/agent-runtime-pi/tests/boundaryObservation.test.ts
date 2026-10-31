import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRuntime, SessionManager, type BoundaryResult } from '@earendil-works/pi-coding-agent'
import { expect, it, onTestFinished } from 'vitest'

import { runtimeId, type ObservationPayload, type OperationResult } from '@cherrystudio/agent-runtime'

import { createPiRuntime } from '../src'

function confirmed<T>(result: OperationResult<T>): T {
  expect(result.status).toBe('confirmed')
  if (result.status !== 'confirmed') throw new Error(result.error.message)
  return result.value
}

it.each(['turn_end', 'agent_before_settle'] as const)(
  'publishes visible %s entries with native identities and order in live and idle observations',
  async (boundary) => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-boundary-observation-'))
    onTestFinished(() => rmSync(cwd, { recursive: true, force: true }))
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    })
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage('Answer')])
    modelRuntime.registerNativeProvider(faux.provider)
    const manager = SessionManager.inMemory(cwd)
    const runtime = confirmed(await createPiRuntime({ backendId: runtimeId('boundary') }))
    onTestFinished(async () => {
      await runtime.shutdown()
    })
    let send!: () => void
    const handle = confirmed(
      await runtime.create({
        cwd,
        agentDir: cwd,
        modelRuntime,
        model: modelRuntime.getModel('faux', 'faux-1')!,
        sessionManager: manager,
        extensionFactories: [
          (pi) => {
            send = () => pi.sendUserMessage('Question')
            const append = (): BoundaryResult => ({
              entries: [
                { type: 'custom_message', customType: 'notice', content: 'Boundary notice', display: true },
                { type: 'custom_message', customType: 'hidden', content: 'Hidden context', display: false },
                { type: 'custom', customType: 'state', data: { done: true } },
                {
                  type: 'custom_message',
                  customType: 'notice',
                  content: [{ type: 'text', text: 'Second notice' }],
                  display: true
                }
              ]
            })
            if (boundary === 'turn_end') pi.on('turn_end', append)
            else pi.on('agent_before_settle', append)
          }
        ]
      })
    )
    const events: ObservationPayload[] = []
    confirmed(
      await handle.observe((event) => {
        events.push(event)
      })
    )
    send()
    await expect.poll(() => events.at(-1)).toMatchObject({ type: 'activity.changed', activity: { state: 'idle' } })
    expect(manager.buildSessionContext().messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'custom', content: 'Boundary notice', display: true }),
        expect.objectContaining({ role: 'custom', content: 'Hidden context', display: false })
      ])
    )
    const notices = manager.getBranch().filter((entry) => entry.type === 'custom_message' && entry.display)
    expect(notices).toHaveLength(2)
    const expected = notices.map((entry, index) => ({
      id: entry.id,
      role: 'user',
      parts: [{ type: 'text', text: index === 0 ? 'Boundary notice' : 'Second notice', state: 'done' }],
      metadata: { completeness: 'complete' }
    }))
    const completed = events.flatMap((event) =>
      event.type === 'message.upsert' &&
      event.message.metadata?.completeness === 'complete' &&
      event.message.role !== 'system'
        ? [event.message]
        : []
    )
    expect(completed.slice(-3)).toMatchObject([
      { role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] },
      ...expected
    ])
    const snapshots: ObservationPayload[] = []
    confirmed(
      await handle.observe((event) => {
        snapshots.push(event)
      })
    )
    await expect
      .poll(() => snapshots[0])
      .toMatchObject({ type: 'snapshot', coverage: 'current-view', activity: { state: 'idle' } })
    const snapshot = snapshots[0]
    if (snapshot.type !== 'snapshot') throw new Error('Missing snapshot')
    expect(snapshot.messages.filter((message) => message.role !== 'system')).toMatchObject([
      { role: 'user', parts: [{ type: 'text', text: 'Question' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] },
      ...expected
    ])
    expect(completed.filter((message) => notices.some((entry) => entry.id === message.id))).toMatchObject(expected)
  }
)
