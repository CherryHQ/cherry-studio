import { describe, expectTypeOf, it } from 'vitest'
import * as z from 'zod'

import { defineRoute } from '../define'
import type { IpcContext, IpcHandlersFor } from '../types'

/**
 * Exercises the reusable `IpcHandlersFor<S>` generic against a local, throwaway
 * schema map.
 *
 * The real domain handler maps (`src/main/ipc/handlers/*`, each annotated
 * `IpcHandlersFor<…>`) already prove the *positive* contract at compile time.
 * What production code can never prove is that an *invalid* handler map is
 * rejected — that is the irreplaceable job of the `@ts-expect-error` cases below.
 * The few positive assertions are kept only as a readable spec of the inferred
 * shape.
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
type SampleHandlers = IpcHandlersFor<typeof sample>

describe('IpcHandlersFor', () => {
  it('derives input, IpcContext, and Promise<output> from the route schemas', () => {
    expectTypeOf<Parameters<SampleHandlers['demo.echo']>[0]>().toEqualTypeOf<{ msg: string }>()
    expectTypeOf<Parameters<SampleHandlers['demo.echo']>[1]>().toEqualTypeOf<IpcContext>()
    expectTypeOf<ReturnType<SampleHandlers['demo.echo']>>().toEqualTypeOf<Promise<{ echoed: string }>>()
  })

  it('infers void input/output for void schemas', () => {
    expectTypeOf<Parameters<SampleHandlers['demo.ping']>[0]>().toEqualTypeOf<void>()
    expectTypeOf<ReturnType<SampleHandlers['demo.ping']>>().toEqualTypeOf<Promise<void>>()
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
