import type { GuestSession } from '../session/GuestSession'
import type { CdpAccessibilityNode } from './accessibilityTypes'

export interface DomSnapshot {
  strings: string[]
  documents: Array<{
    frameId: number
    nodes: {
      backendNodeId: number[]
      parentIndex: number[]
      nodeName: number[]
      attributes: number[][]
      isClickable?: { index: number[] }
    }
    layout: { nodeIndex: number[]; bounds: number[][]; styles: number[][] }
  }>
}

export interface RawSnapshot {
  ax: CdpAccessibilityNode[]
  dom?: DomSnapshot
  viewport: { x: number; y: number; w: number; h: number }
  frameId: string
}

export async function captureSnapshot(session: GuestSession): Promise<RawSnapshot> {
  const ax = await session.send<{ nodes: CdpAccessibilityNode[] }>('Accessibility.getFullAXTree')
  const [dom, viewport] = await Promise.all([
    ax.nodes.length > 20_000
      ? undefined
      : session.send<DomSnapshot>('DOMSnapshot.captureSnapshot', {
          computedStyles: ['cursor', 'display', 'visibility', 'opacity', 'pointer-events'],
          includeDOMRects: true
        }),
    session.send<{ result: { value: RawSnapshot['viewport'] } }>('Runtime.evaluate', {
      expression: '({x:scrollX,y:scrollY,w:innerWidth,h:innerHeight})',
      returnByValue: true,
      silent: true
    })
  ])
  return { ax: ax.nodes, dom, viewport: viewport.result.value, frameId: session.mainFrameId }
}
