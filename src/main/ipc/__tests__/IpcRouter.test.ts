import { defineRoute } from '@shared/ipc/define'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { aiRequestSchemas } from '@shared/ipc/schemas/ai'
import type { IpcContext, IpcHandlersFor } from '@shared/ipc/types'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { IpcRouter } from '../IpcRouter'

const schemas = {
  'demo.echo': defineRoute({
    input: z.object({ msg: z.string() }),
    output: z.object({ echoed: z.string() })
  }),
  'demo.whoami': defineRoute({
    input: z.void(),
    output: z.object({ senderId: z.string().nullable() })
  })
}

const ctx: IpcContext = { senderId: 'win-1' }

function makeRouter(overrides?: Partial<IpcHandlersFor<typeof schemas>>) {
  const echo = vi.fn(async (input: { msg: string }) => ({ echoed: input.msg }))
  const whoami = vi.fn(async (_input: void, c: IpcContext) => ({ senderId: c.senderId }))
  const handlers: IpcHandlersFor<typeof schemas> = { 'demo.echo': echo, 'demo.whoami': whoami, ...overrides }
  return { router: new IpcRouter(schemas, handlers), echo, whoami }
}

const aiStreamSchemas = { 'ai.stream_open': aiRequestSchemas['ai.stream_open'] }

function makeAiStreamRouter() {
  const streamOpen = vi.fn(async () => ({ mode: 'started' as const }))
  const handlers: IpcHandlersFor<typeof aiStreamSchemas> = { 'ai.stream_open': streamOpen }
  return { router: new IpcRouter(aiStreamSchemas, handlers), streamOpen }
}

describe('IpcRouter.dispatch', () => {
  it('routes to the matching handler and returns its result', async () => {
    const { router, echo } = makeRouter()
    const result = await router.dispatch('demo.echo', { msg: 'hi' }, ctx)
    expect(result).toEqual({ echoed: 'hi' })
    expect(echo).toHaveBeenCalledOnce()
  })

  it('passes the IpcContext through to the handler', async () => {
    const { router } = makeRouter()
    const result = await router.dispatch('demo.whoami', undefined, { senderId: 'win-42' })
    expect(result).toEqual({ senderId: 'win-42' })
  })

  it('parses input before invoking the handler', async () => {
    const { router, echo } = makeRouter()
    const parsed = await router.dispatch('demo.echo', { msg: 'hi', extra: 'stripped' }, ctx)
    // zod object strips unknown keys → handler only sees declared fields
    expect(parsed).toEqual({ echoed: 'hi' })
    expect(echo).toHaveBeenCalledWith({ msg: 'hi' }, ctx)
  })

  it('preserves Agent runtime options through the ai.stream_open schema boundary', async () => {
    const { router, streamOpen } = makeAiStreamRouter()
    const request = {
      topicId: 'agent:session-1',
      trigger: 'submit-message',
      userMessageParts: [],
      agentRuntimeOptions: { reasoningEffort: 'xhigh', fastMode: true }
    }

    await router.dispatch('ai.stream_open', request, ctx)

    expect(streamOpen).toHaveBeenCalledWith(request, ctx)
  })

  it('rejects with VALIDATION_FAILED and never calls the handler on invalid input', async () => {
    const { router, echo } = makeRouter()
    await expect(router.dispatch('demo.echo', { msg: 123 }, ctx)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED'
    })
    expect(echo).not.toHaveBeenCalled()
  })

  it('rejects with ROUTE_NOT_FOUND for an unknown route', async () => {
    const { router } = makeRouter()
    const err = await router.dispatch('demo.nope', {}, ctx).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(IpcError)
    expect((err as IpcError).code).toBe('ROUTE_NOT_FOUND')
    expect((err as IpcError).message).toContain('demo.nope')
  })

  // A bare `schemas[route]` resolves inherited Object.prototype members (truthy) for
  // these keys, slips past `if (!def)`, and surfaces as an INTERNAL TypeError. The
  // own-property guard must treat any non-own key as an unknown route.
  it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'rejects inherited prototype key %s with ROUTE_NOT_FOUND, never reaching a handler',
    async (route: string) => {
      const { router, echo, whoami } = makeRouter()
      const err = await router.dispatch(route, {}, ctx).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(IpcError)
      expect((err as IpcError).code).toBe('ROUTE_NOT_FOUND')
      expect(echo).not.toHaveBeenCalled()
      expect(whoami).not.toHaveBeenCalled()
    }
  )

  it('propagates a handler error unchanged (the service layer normalizes it)', async () => {
    const boom = new Error('handler exploded')
    const { router } = makeRouter({
      'demo.echo': async () => {
        throw boom
      }
    })
    await expect(router.dispatch('demo.echo', { msg: 'x' }, ctx)).rejects.toBe(boom)
  })
})
