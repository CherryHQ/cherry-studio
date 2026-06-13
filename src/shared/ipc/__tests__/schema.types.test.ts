import { describe, expectTypeOf, it } from 'vitest'
import * as z from 'zod'

import { defineRoute } from '../define'
import type { IpcEventName, IpcRoute } from '../schemas'
import type { IpcContext, IpcHandlersFor } from '../types'

/**
 * A local, throwaway schema map that exercises the reusable type machinery.
 *
 * Stage 0 ships no real domains, so the *global* registry is empty (asserted at
 * the bottom). The inference logic that matters lives in the generic
 * `IpcHandlersFor<S>`, tested here against `sample` so it is verifiable before
 * any domain is migrated.
 */
const sample = {
  'demo.echo': defineRoute({
    input: z.object({ msg: z.string() }),
    output: z.object({ echoed: z.string() })
  }),
  'demo.ping': defineRoute({
    input: z.void(),
    output: z.void()
  })
}
type Sample = typeof sample
type SampleHandlers = IpcHandlersFor<Sample>

describe('IpcHandlersFor inference', () => {
  it('derives the handler input from the zod input schema', () => {
    expectTypeOf<Parameters<SampleHandlers['demo.echo']>[0]>().toEqualTypeOf<{ msg: string }>()
  })

  it('passes IpcContext as the second handler argument', () => {
    expectTypeOf<Parameters<SampleHandlers['demo.echo']>[1]>().toEqualTypeOf<IpcContext>()
  })

  it('derives the handler result (Promise of the output schema)', () => {
    expectTypeOf<ReturnType<SampleHandlers['demo.echo']>>().toEqualTypeOf<Promise<{ echoed: string }>>()
  })

  it('infers void input/output for void schemas', () => {
    expectTypeOf<Parameters<SampleHandlers['demo.ping']>[0]>().toEqualTypeOf<void>()
    expectTypeOf<ReturnType<SampleHandlers['demo.ping']>>().toEqualTypeOf<Promise<void>>()
  })
})

describe('IpcHandlersFor exhaustiveness', () => {
  it('accepts a fully-implemented handler map', () => {
    const handlers: SampleHandlers = {
      'demo.echo': async ({ msg }) => ({ echoed: msg }),
      'demo.ping': async () => {}
    }
    expectTypeOf(handlers).toEqualTypeOf<SampleHandlers>()
  })

  it('rejects a handler map missing a declared route', () => {
    // @ts-expect-error — 'demo.ping' handler is required by the schema.
    const handlers: SampleHandlers = {
      'demo.echo': async ({ msg }) => ({ echoed: msg })
    }
    void handlers
  })

  it('rejects a handler for a route not in the schema', () => {
    const handlers: SampleHandlers = {
      'demo.echo': async ({ msg }) => ({ echoed: msg }),
      'demo.ping': async () => {},
      // @ts-expect-error — 'demo.extra' is not a declared route.
      'demo.extra': async () => {}
    }
    void handlers
  })

  it('rejects a handler whose result violates the output schema', () => {
    const handlers: SampleHandlers = {
      // @ts-expect-error — output must be { echoed: string }, not { wrong: number }.
      'demo.echo': async () => ({ wrong: 1 }),
      'demo.ping': async () => {}
    }
    void handlers
  })
})

describe('stage-0 global registry is empty', () => {
  it('exposes no routes or events until a domain is migrated', () => {
    expectTypeOf<IpcRoute>().toEqualTypeOf<never>()
    expectTypeOf<IpcEventName>().toEqualTypeOf<never>()
  })
})
