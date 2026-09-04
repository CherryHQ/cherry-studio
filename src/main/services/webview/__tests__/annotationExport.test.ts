import { WEBVIEW_ANNOTATION_LIMITS, type WebviewAnnotation } from '@shared/types/webviewAnnotation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))

import { exportAnnotationDocument } from '../annotationExport'

interface MockGuest {
  id: number
  debugger: {
    attach: ReturnType<typeof vi.fn>
    detach: ReturnType<typeof vi.fn>
    isAttached: ReturnType<typeof vi.fn>
    sendCommand: ReturnType<typeof vi.fn>
  }
  getTitle: ReturnType<typeof vi.fn>
  getURL: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  isDevToolsOpened: ReturnType<typeof vi.fn>
}

const annotation: WebviewAnnotation = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  comment: 'Fix this',
  element: { selector: '#target', tagName: 'button', text: 'Target', ariaLabel: null, role: 'button' }
}

function createGuest(
  sendCommand: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  options: { title?: string; url?: string; devToolsOpened?: boolean } = {}
): MockGuest {
  let attached = false
  return {
    id: 7,
    debugger: {
      attach: vi.fn(() => {
        attached = true
      }),
      detach: vi.fn(() => {
        attached = false
      }),
      isAttached: vi.fn(() => attached),
      sendCommand: vi.fn((method: string, params?: Record<string, unknown>) => {
        if (method === 'Page.getFrameTree') return Promise.resolve({ frameTree: { frame: { id: 'main-frame' } } })
        if (method === 'Page.createIsolatedWorld') return Promise.resolve({ executionContextId: 73 })
        return sendCommand(method, params)
      })
    },
    getTitle: vi.fn(() => options.title ?? 'Example'),
    getURL: vi.fn(() => options.url ?? 'https://example.com/page'),
    isDestroyed: vi.fn(() => false),
    isDevToolsOpened: vi.fn(() => options.devToolsOpened ?? false)
  }
}

const exportFrom = (guest: MockGuest, annotations: WebviewAnnotation[] = [annotation]) =>
  exportAnnotationDocument({
    guest: guest as unknown as Electron.WebContents,
    target: { id: 'mini-app:demo', label: 'Demo' },
    annotations
  })

describe('exportAnnotationDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects duplicate ids before attaching the debugger', async () => {
    const guest = createGuest(async () => ({}))

    await expect(exportFrom(guest, [annotation, annotation])).rejects.toThrow('Annotation ids must be unique')

    expect(guest.debugger.attach).not.toHaveBeenCalled()
  })

  it('uses an isolated world and suppresses form values and value-bearing descendants', async () => {
    const sendCommand = vi.fn(async (method: string) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'selected' } }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 101 } }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        return {
          nodes: [
            {
              nodeId: 'selected',
              ignored: false,
              role: { value: 'textbox' },
              name: { value: 'Email' },
              properties: [
                { name: 'editable', value: { value: true } },
                { name: 'value', value: { value: 'SECRET' } }
              ],
              childIds: ['secret'],
              backendDOMNodeId: 101,
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes') {
        return { nodes: [{ nodeId: 'secret', ignored: false, role: { value: 'text' }, name: { value: 'SECRET' } }] }
      }
      return {}
    })
    const guest = createGuest(sendCommand)

    const markdown = await exportFrom(guest, [{ ...annotation, element: { ...annotation.element, tagName: 'input' } }])

    expect(markdown).toContain('name=Email')
    expect(markdown).not.toContain('SECRET')
    expect(sendCommand).not.toHaveBeenCalledWith('Accessibility.getChildAXNodes', expect.anything())
    expect(guest.debugger.sendCommand).toHaveBeenCalledWith('Page.createIsolatedWorld', {
      frameId: 'main-frame',
      worldName: 'cherry-webview-annotation-accessibility',
      grantUniveralAccess: false
    })
  })

  it('does not cross iframe frame boundaries', async () => {
    const iframe = {
      ...annotation,
      id: '123e4567-e89b-42d3-a456-426614174001',
      element: { ...annotation.element, selector: '#frame', tagName: 'iframe' }
    }
    const button = {
      ...annotation,
      id: '123e4567-e89b-42d3-a456-426614174002',
      element: { ...annotation.element, selector: '#button' }
    }
    const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate') {
        return { result: { objectId: String(params?.expression).includes('#frame') ? 'frame' : 'button' } }
      }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: params?.objectId === 'frame' ? 201 : 202 } }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        const isFrame = params?.backendNodeId === 201
        return {
          nodes: [
            {
              nodeId: isFrame ? 'frame' : 'button',
              ignored: false,
              role: { value: isFrame ? 'Iframe' : 'button' },
              childIds: ['same', 'cross'],
              backendDOMNodeId: params?.backendNodeId,
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes') {
        return {
          nodes: [
            {
              nodeId: 'same',
              ignored: false,
              role: { value: 'text' },
              name: { value: 'Same frame' },
              childIds: [],
              frameId: 'main-frame'
            },
            {
              nodeId: 'cross',
              ignored: false,
              role: { value: 'document' },
              name: { value: 'CROSS FRAME SECRET' },
              childIds: [],
              frameId: 'remote-frame'
            }
          ]
        }
      }
      return {}
    })
    const guest = createGuest(sendCommand)

    const markdown = await exportFrom(guest, [iframe, button])

    expect(markdown).toContain('Same frame')
    expect(markdown).not.toContain('CROSS FRAME SECRET')
    expect(sendCommand.mock.calls.filter(([method]) => method === 'Accessibility.getChildAXNodes')).toHaveLength(1)
  })

  it('enforces per-annotation node and depth budgets', async () => {
    const leaves = Array.from({ length: 100 }, (_, index) => ({
      nodeId: `leaf-${index}`,
      ignored: false,
      role: { value: 'text' },
      name: { value: `Leaf ${index}` },
      childIds: [],
      frameId: 'main-frame'
    }))
    const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'selected' } }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 301 } }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        return {
          nodes: [
            {
              nodeId: 'selected',
              ignored: false,
              role: { value: 'group' },
              childIds: leaves.map((node) => node.nodeId),
              backendDOMNodeId: 301,
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes') {
        if (params?.id === 'selected') return { nodes: leaves }
        const depth = Number(String(params?.id).replace('depth-', ''))
        return {
          nodes: [
            {
              nodeId: `depth-${depth + 1}`,
              ignored: false,
              role: { value: 'group' },
              name: { value: `Depth ${depth + 1}` },
              childIds: [`depth-${depth + 2}`],
              frameId: 'main-frame'
            }
          ]
        }
      }
      return {}
    })
    const guest = createGuest(sendCommand)

    const markdown = await exportFrom(guest)

    expect(markdown).toContain('Leaf 0')
    expect(markdown).not.toContain('Leaf 99')
    expect(markdown).toContain('Accessibility context truncated: yes')

    const depthCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'selected' } }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 302 } }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        return {
          nodes: [
            {
              nodeId: 'depth-1',
              ignored: false,
              role: { value: 'group' },
              name: { value: 'Depth 1' },
              childIds: ['depth-2'],
              backendDOMNodeId: 302,
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes') {
        const depth = Number(String(params?.id).replace('depth-', ''))
        return {
          nodes: [
            {
              nodeId: `depth-${depth + 1}`,
              ignored: false,
              role: { value: 'group' },
              name: { value: `Depth ${depth + 1}` },
              childIds: [`depth-${depth + 2}`],
              frameId: 'main-frame'
            }
          ]
        }
      }
      return {}
    })
    const depthGuest = createGuest(depthCommand)
    const depthMarkdown = await exportFrom(depthGuest)
    expect(depthMarkdown).toContain('Depth 5')
    expect(depthMarkdown).not.toContain('Depth 6')
  })

  it('enforces the request budget without dropping later annotations', async () => {
    const annotations = Array.from({ length: 6 }, (_, index) => ({
      ...annotation,
      id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
      comment: `Annotation ${index}`
    }))
    const leaves = Array.from({ length: 100 }, (_, index) => ({
      nodeId: `leaf-${index}`,
      ignored: false,
      role: { value: 'text' },
      name: { value: `Leaf ${index}` },
      childIds: [],
      frameId: 'main-frame'
    }))
    const sendCommand = vi.fn(async (method: string) => {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'selected' } }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 401 } }
      if (method === 'Accessibility.getAXNodeAndAncestors') {
        return {
          nodes: [
            {
              nodeId: 'selected',
              ignored: false,
              role: { value: 'group' },
              childIds: leaves.map((node) => node.nodeId),
              backendDOMNodeId: 401,
              frameId: 'main-frame'
            }
          ]
        }
      }
      if (method === 'Accessibility.getChildAXNodes') return { nodes: leaves }
      return {}
    })
    const guest = createGuest(sendCommand)

    const markdown = await exportFrom(guest, annotations)

    expect(markdown.match(/^### \d+\. Annotation$/gm)).toHaveLength(6)
    expect(markdown).toContain('Accessibility status: `budget_exceeded`')
  })

  it('returns a timeout fallback and always detaches the debugger', async () => {
    vi.useFakeTimers()
    try {
      const guest = createGuest((method) =>
        method === 'Runtime.enable' ? new Promise(() => undefined) : Promise.resolve({})
      )
      const result = exportFrom(guest)

      await vi.advanceTimersByTimeAsync(5_001)

      await expect(result).resolves.toContain('Accessibility status: `timeout`')
      expect(guest.debugger.detach).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not expose capture errors and detaches the debugger', async () => {
    const guest = createGuest(async (method) => {
      if (method === 'Runtime.evaluate') throw new Error('protocol details must not leak')
      return {}
    })

    const markdown = await exportFrom(guest)

    expect(markdown).toContain('Accessibility status: `capture_failed`')
    expect(markdown).not.toContain('protocol details')
    expect(guest.debugger.detach).toHaveBeenCalledOnce()
  })

  it('sanitizes page metadata and caps oversized exports at complete annotation blocks', async () => {
    const guest = createGuest(async () => ({}), {
      title: '  Private   dashboard  ',
      url: 'https://user:secret@example.com/account?token=secret#billing',
      devToolsOpened: true
    })
    const largeLocator = {
      ...annotation.element,
      selector: `#${'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.selector - 1)}`,
      text: 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.text),
      ariaLabel: 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.ariaLabel),
      role: 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.role)
    }
    const annotations = Array.from({ length: WEBVIEW_ANNOTATION_LIMITS.annotations }, (_, index) => ({
      ...annotation,
      id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
      comment: 'x'.repeat(WEBVIEW_ANNOTATION_LIMITS.comment),
      element: largeLocator,
      region: {
        rect: { x: 0, y: 0, width: 100, height: 100 },
        elements: Array.from({ length: WEBVIEW_ANNOTATION_LIMITS.regionElements }, () => largeLocator)
      }
    }))

    const markdown = await exportFrom(guest, annotations)
    const headings = markdown.match(/^### \d+\. Annotation$/gm) ?? []

    expect(markdown).toContain('- Page: Private dashboard')
    expect(markdown).toContain('- URL: `https://example.com/account`')
    expect(markdown).not.toContain('secret')
    expect(markdown.length).toBeLessThanOrEqual(WEBVIEW_ANNOTATION_LIMITS.exportMarkdown)
    expect(headings.length).toBeGreaterThan(0)
    expect(markdown).toMatch(/> Output truncated: \d+ annotations omitted\.$/)
  })
})
