import { defineRoute } from '@shared/ipc/define'
import { IpcError } from '@shared/ipc/errors'
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
