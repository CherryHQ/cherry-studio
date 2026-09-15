import type { BrowserRef, CommandOptions } from '../browserUse'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'

const MIN_TARGET_AREA = 1

function getQuadArea(quad: number[]): number {
  let twiceSignedArea = 0
  for (let i = 0; i < quad.length; i += 2) {
    const next = (i + 2) % quad.length
    twiceSignedArea += quad[i] * quad[next + 1] - quad[next] * quad[i + 1]
  }
  return Math.abs(twiceSignedArea) / 2
}

function getQuadCenter(quad: number[]) {
  return {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4
  }
}

export async function withElement<T>(
  session: GuestSession,
  ref: BrowserRef,
  action: (objectId: string, backendNodeId: number, check: () => void) => Promise<T>,
  options: CommandOptions = {}
): Promise<T> {
  let backendNodeId = session.resolveRef(ref)
  const check = () => {
    if (session.resolveRef(ref) !== backendNodeId) throw new BrowserSessionError('stale_ref')
    options.signal?.throwIfAborted()
  }
  let objectId: string | undefined
  const release = async () => {
    if (objectId)
      await session.send('Runtime.releaseObject', { objectId }, { deadline: Date.now() + 1000 }).catch(() => undefined)
    objectId = undefined
  }
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await session.send('DOM.resolveNode', { backendNodeId }, options)
        objectId = result.object.objectId
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/No node with given id|Could not find node with given id/i.test(error.message)
        )
          throw error
      }
      check()
      if (
        objectId &&
        (await callOnElement<boolean>(session, objectId, 'function(){ return this.isConnected }', [], options))
      )
        break
      await release()
      if (attempt === 1) throw new BrowserSessionError('stale_ref')
      backendNodeId = await session.recoverRef(ref, options)
    }
    check()
    return await action(objectId!, backendNodeId, check)
  } finally {
    await release()
  }
}

export async function callOnElement<T>(
  session: GuestSession,
  objectId: string,
  functionDeclaration: string,
  args: unknown[],
  options: CommandOptions
) {
  const response = await session.send(
    'Runtime.callFunctionOn',
    {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true
    },
    options
  )
  if (response.exceptionDetails) throw new BrowserSessionError('not_found')
  return response.result.value as T
}

export async function resolveTarget(session: GuestSession, ref: BrowserRef, options: CommandOptions = {}) {
  return withElement(
    session,
    ref,
    async (objectId, backendNodeId, check) => {
      const usable = await callOnElement<boolean>(
        session,
        objectId,
        'function(){ return this.isConnected && !this.matches(":disabled") && this.getAttribute("aria-disabled") !== "true" }',
        [],
        options
      )
      if (!usable) throw new BrowserSessionError('not_found')
      await session.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }, options)
      const { quads } = await session.send('DOM.getContentQuads', { backendNodeId }, options)
      let quad: number[] | undefined
      let largestArea = MIN_TARGET_AREA
      for (const candidate of quads) {
        if (candidate.length !== 8) continue
        const area = getQuadArea(candidate)
        if (area > largestArea) {
          quad = candidate
          largestArea = area
        }
      }
      if (!quad) throw new BrowserSessionError('not_found')
      const { x, y } = getQuadCenter(quad)
      const { cssLayoutViewport } = await session.send('Page.getLayoutMetrics', undefined, options)
      // DOM hit testing uses document coordinates; mouse input and quads use viewport coordinates.
      const hit = await session.send(
        'DOM.getNodeForLocation',
        {
          x: Math.round(x + cssLayoutViewport.pageX),
          y: Math.round(y + cssLayoutViewport.pageY),
          includeUserAgentShadowDOM: true
        },
        options
      )
      let occluded = hit.backendNodeId !== backendNodeId
      if (occluded) {
        const { object } = await session.send('DOM.resolveNode', { backendNodeId: hit.backendNodeId }, options)
        const hitObjectId = object.objectId
        if (!hitObjectId) throw new BrowserSessionError('not_found')
        try {
          const result = await session.send(
            'Runtime.callFunctionOn',
            {
              objectId,
              functionDeclaration:
                'function(node){ while(node){ if(node === this) return true; node = node.parentNode || node.host } return false }',
              arguments: [{ objectId: hitObjectId }],
              returnByValue: true
            },
            options
          )
          occluded = !result.result.value
        } finally {
          await session.send('Runtime.releaseObject', { objectId: hitObjectId }, options).catch(() => undefined)
        }
      }
      check()
      return { x, y, occluded }
    },
    options
  )
}
