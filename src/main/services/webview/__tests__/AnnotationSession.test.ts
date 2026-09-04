import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { AnnotationSession } from '../AnnotationSession'

interface MockWebContents extends EventEmitter {
  isDestroyed: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
}

const createContents = () => {
  const contents = new EventEmitter() as MockWebContents
  contents.isDestroyed = vi.fn(() => false)
  contents.send = vi.fn()
  return contents
}

const createIds = (...ids: string[]) => {
  let index = 0
  return () => ids[index++] ?? ids.at(-1)!
}

describe('AnnotationSession', () => {
  it('announces the current session only after dom-ready and keeps same-document navigation', () => {
    const contents = createContents()
    const session = new AnnotationSession(
      contents as unknown as Electron.WebContents,
      vi.fn(),
      createIds('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')
    )

    expect(session.isCurrent('00000000-0000-4000-8000-000000000001')).toBe(false)
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    contents.emit('dom-ready')

    expect(contents.send).toHaveBeenCalledWith('cherry:webview-annotation', {
      type: 'start_session',
      sessionId: '00000000-0000-4000-8000-000000000001'
    })
    expect(session.isCurrent('00000000-0000-4000-8000-000000000001')).toBe(true)
  })

  it('rotates immediately for a new main-frame document and never rolls back after failed load', () => {
    const contents = createContents()
    const session = new AnnotationSession(
      contents as unknown as Electron.WebContents,
      vi.fn(),
      createIds('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')
    )
    contents.emit('dom-ready')

    contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    expect(session.isCurrent('00000000-0000-4000-8000-000000000001')).toBe(true)

    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(session.isCurrent('00000000-0000-4000-8000-000000000001')).toBe(false)
    contents.emit('did-fail-load', {})
    contents.emit('dom-ready')

    expect(contents.send).toHaveBeenLastCalledWith('cherry:webview-annotation', {
      type: 'start_session',
      sessionId: '00000000-0000-4000-8000-000000000002'
    })
    expect(session.isCurrent('00000000-0000-4000-8000-000000000002')).toBe(true)
  })

  it('keeps a failed announcement unready and rotates when the render process exits', () => {
    const contents = createContents()
    contents.send.mockImplementationOnce(() => {
      throw new Error('gone')
    })
    const session = new AnnotationSession(
      contents as unknown as Electron.WebContents,
      vi.fn(),
      createIds('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')
    )

    contents.emit('dom-ready')
    expect(session.isCurrent('00000000-0000-4000-8000-000000000001')).toBe(false)
    contents.emit('render-process-gone')
    contents.emit('dom-ready')
    expect(session.isCurrent('00000000-0000-4000-8000-000000000002')).toBe(true)
  })

  it('serializes tasks and rejects a result invalidated while the task is running', async () => {
    const contents = createContents()
    const sessionId = '00000000-0000-4000-8000-000000000001'
    const session = new AnnotationSession(
      contents as unknown as Electron.WebContents,
      vi.fn(),
      createIds(sessionId, '00000000-0000-4000-8000-000000000002')
    )
    contents.emit('dom-ready')
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const first = session.run(sessionId, async () => {
      order.push('first:start')
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      order.push('first:end')
      return 'first'
    })
    const second = session.run(sessionId, async () => {
      order.push('second')
      return 'second'
    })

    await vi.waitFor(() => expect(order).toEqual(['first:start']))
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    releaseFirst?.()

    await expect(first).rejects.toThrow('Annotation document session is stale')
    await expect(second).rejects.toThrow('Annotation document session is stale')
    expect(order).toEqual(['first:start', 'first:end'])
  })

  it('rejects stale work before queueing or task execution', async () => {
    const contents = createContents()
    const task = vi.fn()
    const session = new AnnotationSession(
      contents as unknown as Electron.WebContents,
      vi.fn(),
      createIds('00000000-0000-4000-8000-000000000001')
    )

    await expect(session.run('00000000-0000-4000-8000-000000000001', task)).rejects.toThrow(
      'Annotation document session is stale'
    )
    expect(task).not.toHaveBeenCalled()
  })

  it('disposes symmetrically and reports destruction exactly once', () => {
    const contents = createContents()
    const onDestroyed = vi.fn()
    const session = new AnnotationSession(
      contents as unknown as Electron.WebContents,
      onDestroyed,
      createIds('00000000-0000-4000-8000-000000000001')
    )

    expect(contents.eventNames()).toEqual(
      expect.arrayContaining(['did-start-navigation', 'render-process-gone', 'dom-ready', 'destroyed'])
    )
    contents.emit('destroyed')
    contents.emit('destroyed')
    contents.emit('dom-ready')

    expect(onDestroyed).toHaveBeenCalledOnce()
    expect(contents.send).not.toHaveBeenCalled()
    expect(contents.listenerCount('did-start-navigation')).toBe(0)
    expect(contents.listenerCount('render-process-gone')).toBe(0)
    expect(contents.listenerCount('dom-ready')).toBe(0)
    expect(contents.listenerCount('destroyed')).toBe(0)
    session.dispose()
    expect(onDestroyed).toHaveBeenCalledOnce()
  })
})
