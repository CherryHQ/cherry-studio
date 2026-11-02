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
  'replaces live and idle views after %s compaction without resurrecting removed messages',
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
                { type: 'custom_message', customType: 'notice', content: 'Removed notice', display: true },
                { type: 'compaction', summary: 'Compacted context', firstKeptEntryId: null },
                { type: 'custom_message', customType: 'notice', content: 'Retained notice', display: true },
                { type: 'custom_message', customType: 'notice', content: 'Last notice', display: true }
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
    expect(
      manager
        .buildSessionContext()
        .messages.some((message) => 'content' in message && message.content === 'Removed notice')
    ).toBe(false)
    const notices = manager
      .getBranch()
      .filter(
        (entry) =>
          entry.type === 'custom_message' && (entry.content === 'Retained notice' || entry.content === 'Last notice')
      )
    expect(notices).toHaveLength(2)
    const expected = notices.map((entry, index) => ({
      id: entry.id,
      role: 'user',
      parts: [{ type: 'text', text: index === 0 ? 'Retained notice' : 'Last notice', state: 'done' }],
      metadata: { completeness: 'complete' }
    }))
    const replacements = events.filter((event) => event.type === 'snapshot')
    expect(replacements.at(-1)?.messages.filter((message) => message.role !== 'system')).toMatchObject(expected)
    expect(
      events
        .flatMap((event) => (event.type === 'message.upsert' ? [event.message] : []))
        .some((message) => message.parts.some((part) => part.type === 'text' && part.text === 'Removed notice'))
    ).toBe(false)
    const snapshots: ObservationPayload[] = []
    confirmed(
      await handle.observe((event) => {
        snapshots.push(event)
      })
    )
    await expect.poll(() => snapshots[0]).toMatchObject({ type: 'snapshot', activity: { state: 'idle' } })
    const snapshot = snapshots[0]
    if (snapshot.type !== 'snapshot') throw new Error('Missing snapshot')
    expect(snapshot.messages.filter((message) => message.role !== 'system')).toMatchObject(expected)

    const freshRuntime = confirmed(await createPiRuntime({ backendId: runtimeId('fresh') }))
    onTestFinished(async () => {
      await freshRuntime.shutdown()
    })
    const fresh = confirmed(
      await freshRuntime.create({
        cwd,
        agentDir: cwd,
        modelRuntime,
        model: modelRuntime.getModel('faux', 'faux-1')!,
        sessionManager: manager
      })
    )
    const restored: ObservationPayload[] = []
    confirmed(
      await fresh.observe((event) => {
        restored.push(event)
      })
    )
    await expect.poll(() => restored[0]).toMatchObject({ type: 'snapshot' })
    const freshSnapshot = restored[0]
    if (freshSnapshot.type !== 'snapshot') throw new Error('Missing fresh snapshot')
    expect(snapshot.messages).toEqual(freshSnapshot.messages)
  }
)
