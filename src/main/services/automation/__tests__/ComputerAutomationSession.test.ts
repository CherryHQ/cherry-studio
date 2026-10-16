import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { ComputerUse, type ComputerUseClient, type Element, type Snapshot } from '@cherrystudio/computer-use'
import type * as ComputerUseModule from '@cherrystudio/computer-use'
import { BaseService } from '@main/core/lifecycle'
import type { UtilityProcessRequestOptions } from '@main/core/utilityProcess/types'

import { ComputerUseService } from '../../ComputerUseService'
import { AutomationOutput } from '../AutomationOutput'
import { AutomationReplService } from '../AutomationReplService'
import { ComputerAutomationSession } from '../ComputerAutomationSession'
import type { AutomationKernelContract } from '../contracts'
import { AutomationKernel } from '../utilityEntries/AutomationKernel'

vi.mock('@cherrystudio/computer-use', async (original) => ({
  ...(await original<typeof ComputerUseModule>()),
  ComputerUse: { start: vi.fn() }
}))

let repl: AutomationReplService | undefined
let service: ComputerUseService
let session: ComputerAutomationSession
let snapshot: Snapshot
let captures: number
let actions: string[]
const signal = new AbortController().signal
const run = (name: string, args = {}) => session.execute(name, args, 'Dia', signal)

beforeEach(() => {
  BaseService.resetInstances()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.computer_use.agent_control.enabled', true)
  captures = 0
  actions = []
  snapshot = {
    id: 'native-snapshot',
    appSessionId: 'native-session',
    app: { id: 'dia', name: 'Dia' },
    window: { id: 'window', title: 'Article' },
    tree: {
      status: 'available',
      elements: Array.from({ length: 1200 }, (_, i) => ({
        id: String(i),
        ...(i ? { parentId: '0' } : {}),
        role: 'AXStaticText',
        name: `第 ${i} 段 "标题" actions=press`,
        value: '正文🚀\\\n'.repeat(60),
        actions: ['click'],
        secondaryActions: []
      })),
      truncated: ['nodes']
    },
    screenshot: { status: 'unavailable', reason: { code: 'CAPTURE_FAILED', message: 'No capture' } }
  }
  const client = {
    listApps: async () => [snapshot.app],
    openAppSession: async () => ({ id: 'native-session', app: snapshot.app, status: 'active' }),
    getAppState: async () => {
      captures++
      return snapshot
    },
    perform: async ({ elementId }: { elementId: string }) => {
      actions.push(elementId)
      return { status: 'completed', appSessionId: 'native-session' }
    },
    onClosed: () => () => {},
    stopAppSession: async () => ({ appSessionId: 'native-session', status: 'stopped', cleanup: 'complete' }),
    close: async () => {}
  } as unknown as ComputerUseClient
  vi.mocked(ComputerUse.start).mockResolvedValue(client)
  service = new ComputerUseService()
  session = new ComputerAutomationSession(service, service.createTask('owner', 'Conversation'))
})

afterEach(async () => {
  await repl?._doStop()
  repl = undefined
  await service._doStop()
  vi.restoreAllMocks()
})

describe('computer AX pages', () => {
  it('delivers structured fields through the real JS kernel without duplicate outline or Pi-sized output', async () => {
    const kernel = new AutomationKernel()
    const get = application.getContainer().get.bind(application.getContainer())
    vi.spyOn(application, 'get').mockImplementation(((name: string) => {
      if (name === 'ComputerUseService') return service
      if (name === 'UtilityProcessManager')
        return {
          register: () => {},
          createInstance: () => ({
            request: async (
              _method: string,
              input: AutomationKernelContract['methods']['execute']['input'],
              options: UtilityProcessRequestOptions<never>
            ) =>
              kernel.execute(input, {
                signal: options.signal!,
                callHost: (domain, input) => options.onHostCall!(domain, input, options.signal!),
                emit: () => {},
                logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
              }),
            stop: async () => kernel.dispose(),
            dispose: async () => kernel.dispose()
          })
        }
      return get(name as Parameters<typeof get>[0])
    }) as typeof application.get)
    repl = new AutomationReplService()
    await repl._doInit()
    const run = repl.beginRun(
      { kind: 'topic', sessionId: 'topic', ownerId: 'assistant', label: 'Test' },
      'run',
      () => ({ browser: false, computer: true })
    )
    for (const code of [
      "var app = await computer.getApp('Dia')",
      'var state = await app.getAXState({ maxTreeNodes: 1200, textLimit: 2000 });',
      'state = await app.getAXState({ cursor: state.page.nextCursor })'
    ]) {
      const result = await run.execute(code)
      expect(result.isError).toBe(false)
      const texts = result.content.filter((part) => part.type === 'text').map((part) => part.text)
      expect(Buffer.byteLength(texts.join('\n'))).toBeLessThan(20 * 1024)
      const observation = texts.filter((text) => text.startsWith('OBSERVATION '))
      expect(observation).toHaveLength(1)
      expect(JSON.parse(observation[0].slice(observation[0].indexOf('\n') + 1))).not.toHaveProperty('text')
      expect(texts.filter((text) => text.includes('第 '))).toHaveLength(1)
      expect(observation[0]).not.toContain('OMITTED')
    }
    const extracted = await run.execute(
      "state.tree.elements.filter(e => e.role === 'AXStaticText').slice(0, 1).map(e => ({ name: e.name, value: e.value, actions: e.actions }))"
    )
    expect(extracted.isError).toBe(false)
    const result = extracted.content.find((part) => part.type === 'text' && part.text.startsWith('[{'))
    if (result?.type !== 'text') throw new Error('Missing extracted value')
    expect(JSON.parse(result.text)).toEqual([
      { name: expect.stringContaining('actions=press'), value: '正文🚀\\\n'.repeat(60), actions: ['click'] }
    ])
    expect(captures).toBe(2)
  })

  it('delivers a large multilingual tree as complete structured nodes without recapturing or omitting it', async () => {
    let result = await run('getApp', { query: 'Dia' })
    const elements: Element[] = []
    if (!('displayValue' in result)) throw new Error('Missing AX')
    const observationId = result.displayValue.id
    expect(Buffer.byteLength(JSON.stringify(result.displayValue))).toBeLessThanOrEqual(4_000)
    do {
      if (!('displayValue' in result)) throw new Error('Missing model observation')
      const page = result.displayValue
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(16_000)
      expect(page).not.toHaveProperty('text')
      expect(page).toMatchObject({ id: observationId, tree: { status: 'available', truncated: ['nodes'] } })
      if (page.tree?.status !== 'available') throw new Error('AX unavailable')
      expect(page.page).toMatchObject({ offset: elements.length, returned: page.tree.elements.length, total: 1200 })
      expect(page.tree.elements.length).toBeGreaterThan(0)
      elements.push(...page.tree.elements)
      const output = new AutomationOutput()
      output.add(page)
      expect(JSON.stringify(output.content())).not.toContain('OMITTED')
      if (!page.page?.nextCursor) break
      result = await run('getAXState', { cursor: page.page.nextCursor })
    } while (elements.length <= 1200)
    expect(elements).toHaveLength(1200)
    expect(captures).toBe(1)
    expect(new Set(elements.map((element) => element.id)).size).toBe(1200)
    expect(elements[1199]).toMatchObject({
      name: '第 1199 段 "标题" actions=press',
      value: '正文🚀\\\n'.repeat(60),
      parentId: elements[0].id,
      actions: ['click']
    })
    await run('click', { ref: elements[1199].id })
    expect(actions).toEqual(['1199'])
  })

  it.each(['click', 'getAXState', 'getScreenshot', 'getApp'])('invalidates old cursors after %s', async (operation) => {
    const first = await run('getApp', { query: 'Dia' })
    if (!('displayValue' in first) || first.displayValue.tree?.status !== 'available') throw new Error('Missing AX')
    const cursor = first.displayValue.page?.nextCursor
    expect(cursor).toBeTruthy()
    await run(
      operation,
      operation === 'click'
        ? { ref: first.displayValue.tree.elements[0].id }
        : operation === 'getApp'
          ? { query: 'Dia' }
          : {}
    )
    await expect(run('getAXState', { cursor })).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' })
  })

  it('rejects a cached page after the user stops control', async () => {
    const first = await run('getApp', { query: 'Dia' })
    if (!('displayValue' in first)) throw new Error('Missing AX')
    await service.stopApp('owner', 'dia')
    await expect(run('getAXState', { cursor: first.displayValue.page?.nextCursor })).rejects.toMatchObject({
      code: 'UNKNOWN_APP_SESSION'
    })
    expect(captures).toBe(1)
  })
  it('does not authorize an undisplayed node or consume a valid cursor on an invalid read', async () => {
    const first = await run('getApp', { query: 'Dia' })
    if (!('displayValue' in first)) throw new Error('Missing AX')
    await expect(run('click', { ref: `${first.displayValue.id}:1199` })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT'
    })
    await expect(run('getAXState', { cursor: 'invented' })).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' })
    const next = await run('getAXState', { cursor: first.displayValue.page?.nextCursor })
    expect(next.value).toMatchObject({ page: { offset: first.displayValue.page?.returned } })
    expect(actions).toEqual([])
    expect(captures).toBe(1)
    await expect(run('getAXState', { cursor: first.displayValue.page?.nextCursor })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT'
    })
  })

  it('rechecks disabled control on cached reads and rejects cursors from another run', async () => {
    const first = await run('getApp', { query: 'Dia' })
    if (!('displayValue' in first)) throw new Error('Missing AX')
    const cursor = first.displayValue.page?.nextCursor
    MockMainPreferenceServiceUtils.setPreferenceValue('app.computer_use.agent_control.enabled', false)
    await expect(run('getAXState', { cursor })).rejects.toMatchObject({ code: 'CONTROL_DISABLED' })
    MockMainPreferenceServiceUtils.setPreferenceValue('app.computer_use.agent_control.enabled', true)
    session = new ComputerAutomationSession(service, service.createTask('other', 'Other run'))
    await expect(run('getAXState', { cursor })).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' })
    expect(captures).toBe(1)
  })

  it('reports a single oversized node explicitly instead of returning an empty successful page', async () => {
    await run('getApp', { query: 'Dia' })
    if (snapshot.tree.status !== 'available') throw new Error('Missing AX')
    snapshot.tree.elements = [{ ...snapshot.tree.elements[0], name: '🚀'.repeat(2000), value: '🚀'.repeat(2000) }]
    await expect(run('getAXState', { textLimit: 2000 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('textLimit: 200')
    })
    await expect(run('typeText', { text: 'do not type' })).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' })
    expect(actions).toEqual([])
  })

  it('distinguishes native unavailability from an available empty tree', async () => {
    snapshot.tree = {
      status: 'unavailable',
      reason: { code: 'PERMISSION_REQUIRED', message: 'Accessibility required' }
    }
    const unavailable = await run('getApp', { query: 'Dia' })
    expect(unavailable.value).toMatchObject({ tree: snapshot.tree })
    expect(unavailable.value).not.toHaveProperty('page')
    snapshot.tree = { status: 'available', elements: [], truncated: [] }
    const empty = await run('getAXState')
    expect(empty.value).toMatchObject({ tree: snapshot.tree, page: { offset: 0, returned: 0, total: 0 } })
    if (!('displayValue' in empty)) throw new Error('Missing AX')
    expect(empty.displayValue.page?.nextCursor).toBeUndefined()
  })
  it('invalidates pages across aliases of the same native app session', async () => {
    const first = await run('getApp', { query: 'Dia' })
    if (!('displayValue' in first)) throw new Error('Missing AX')
    await session.execute('getApp', { query: 'dia' }, undefined, signal)
    await expect(run('getAXState', { cursor: first.displayValue.page?.nextCursor })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT'
    })
  })
})
