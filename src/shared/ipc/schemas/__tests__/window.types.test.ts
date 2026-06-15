import { describe, expectTypeOf, it } from 'vitest'
import type * as z from 'zod'

import type { windowRequestSchemas } from '../window'
import { type WindowEventSchemas } from '../window'

/**
 * Type-level contract for the window schemas. Enforced by `pnpm typecheck` (tsgo);
 * vitest's esbuild path does not check types. These lock the inferred shapes so a
 * drift surfaces here rather than silently at a call site.
 */
type Schemas = typeof windowRequestSchemas

describe('window schema type contracts', () => {
  it('set_full_screen takes a bare boolean input (single-value convention)', () => {
    expectTypeOf<z.infer<Schemas['window.set_full_screen']['input']>>().toEqualTypeOf<boolean>()
  })

  it('query routes return their read value', () => {
    expectTypeOf<z.infer<Schemas['window.is_maximized']['output']>>().toEqualTypeOf<boolean>()
    expectTypeOf<z.infer<Schemas['window.is_full_screen']['output']>>().toEqualTypeOf<boolean>()
  })

  it('get_init_data output is opaque (unknown), to be cast by the consumer', () => {
    expectTypeOf<z.infer<Schemas['window.get_init_data']['output']>>().toEqualTypeOf<unknown>()
  })

  it('fire-and-forget controls produce void output', () => {
    expectTypeOf<z.infer<Schemas['window.close']['output']>>().toEqualTypeOf<void>()
    expectTypeOf<z.infer<Schemas['window.minimize']['output']>>().toEqualTypeOf<void>()
  })

  it('declares the three directed window events with their payload types', () => {
    expectTypeOf<WindowEventSchemas['window.maximized_changed']>().toEqualTypeOf<boolean>()
    expectTypeOf<WindowEventSchemas['window.fullscreen_changed']>().toEqualTypeOf<boolean>()
    expectTypeOf<WindowEventSchemas['window.reused']>().toEqualTypeOf<unknown>()
  })
})
