import { describe, expectTypeOf, it } from 'vitest'
import type * as z from 'zod'

import type { selectionRequestSchemas } from '../selection'
import { type SelectionEventSchemas } from '../selection'

/**
 * Type-level contract for the selection schemas. Enforced by `pnpm typecheck`
 * (tsgo); vitest's esbuild path does not check types. These lock the zod schemas
 * structurally against the domain types they stand in for, so a drift in either
 * surfaces here rather than silently at a call site.
 */
type Schemas = typeof selectionRequestSchemas

describe('selection schema type contracts', () => {
  // actionItem ≡ SelectionActionItem is now enforced at the definition by the
  // `z.ZodType<SelectionActionItem>` annotation on selectionActionItemSchema.
  it('get_linux_env_info output is the four-flag env shape', () => {
    type LinuxEnv = z.infer<Schemas['selection.get_linux_env_info']['output']>
    expectTypeOf<LinuxEnv>().toEqualTypeOf<{
      isLinuxWaylandDisplay: boolean
      isLinuxXWaylandMode: boolean
      hasLinuxInputDeviceAccess: boolean
      isLinuxCompositorCompatible: boolean
    }>()
  })

  it('write_to_clipboard / pin_action_window take a bare primitive input (single-value convention)', () => {
    expectTypeOf<z.infer<Schemas['selection.write_to_clipboard']['input']>>().toEqualTypeOf<string>()
    expectTypeOf<z.infer<Schemas['selection.pin_action_window']['input']>>().toEqualTypeOf<boolean>()
  })

  it('declares the two selection events with their payload types', () => {
    expectTypeOf<SelectionEventSchemas['selection.toolbar_visibility_change']>().toEqualTypeOf<boolean>()
    expectTypeOf<SelectionEventSchemas['selection.text_selected']>().not.toBeNever()
  })
})
