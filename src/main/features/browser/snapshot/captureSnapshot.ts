import type { Protocol } from 'devtools-protocol'

import type { CommandOptions } from '../browserUse'
import type { GuestSession } from '../session/GuestSession'
import type { CdpAccessibilityNode } from './accessibilityTypes'

export interface DomSnapshot {
  strings: Protocol.DOMSnapshot.CaptureSnapshotResponse['strings']
  documents: Array<{
    frameId: Protocol.DOMSnapshot.DocumentSnapshot['frameId']
    nodes: Pick<
      Protocol.DOMSnapshot.NodeTreeSnapshot,
      'backendNodeId' | 'parentIndex' | 'nodeName' | 'attributes' | 'isClickable'
    >
    layout: Pick<Protocol.DOMSnapshot.LayoutTreeSnapshot, 'nodeIndex' | 'bounds' | 'styles'>
  }>
}

export interface RawSnapshot {
  ax: CdpAccessibilityNode[]
  dom?: DomSnapshot
  viewport: { x: number; y: number; w: number; h: number }
  frameId: string
}

export async function captureSnapshot(session: GuestSession, options: CommandOptions = {}): Promise<RawSnapshot> {
  const ax = await session.send('Accessibility.getFullAXTree', undefined, options)
  const [dom, viewport] = await Promise.all([
    ax.nodes.length > 20_000
      ? undefined
      : session.send(
          'DOMSnapshot.captureSnapshot',
          {
            computedStyles: ['cursor', 'display', 'visibility', 'opacity', 'pointer-events'],
            includeDOMRects: true
          },
          options
        ),
    session.send(
      'Runtime.evaluate',
      {
        expression: '({x:scrollX,y:scrollY,w:innerWidth,h:innerHeight})',
        returnByValue: true,
        silent: true
      },
      options
    )
  ])
  return { ax: ax.nodes, dom, viewport: viewport.result.value, frameId: session.mainFrameId }
}
