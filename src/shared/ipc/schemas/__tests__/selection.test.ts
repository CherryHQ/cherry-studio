import { describe, expect, it } from 'vitest'

import { selectionRequestSchemas } from '../selection'

/**
 * Runtime validation contract for the selection request routes. The router always
 * `safeParse`s input, so these assertions lock what each route accepts/rejects.
 * Type-level inference (z.infer ≡ domain types) is covered in selection.types.test.ts.
 */
describe('selectionRequestSchemas', () => {
  it('declares exactly the six migrated selection routes', () => {
    expect(Object.keys(selectionRequestSchemas).sort()).toEqual(
      [
        'selection.determine_toolbar_size',
        'selection.get_linux_env_info',
        'selection.hide_toolbar',
        'selection.pin_action_window',
        'selection.process_action',
        'selection.write_to_clipboard'
      ].sort()
    )
  })

  it('hide_toolbar / get_linux_env_info take void input', () => {
    expect(selectionRequestSchemas['selection.hide_toolbar'].input.safeParse(undefined).success).toBe(true)
    expect(selectionRequestSchemas['selection.get_linux_env_info'].input.safeParse(undefined).success).toBe(true)
  })

  it('write_to_clipboard accepts a string and rejects non-strings', () => {
    const schema = selectionRequestSchemas['selection.write_to_clipboard'].input
    expect(schema.safeParse('copy me').success).toBe(true)
    expect(schema.safeParse(123).success).toBe(false)
  })

  it('pin_action_window accepts a boolean and rejects non-booleans', () => {
    const schema = selectionRequestSchemas['selection.pin_action_window'].input
    expect(schema.safeParse(true).success).toBe(true)
    expect(schema.safeParse('yes').success).toBe(false)
  })

  it('determine_toolbar_size requires numeric width and height', () => {
    const schema = selectionRequestSchemas['selection.determine_toolbar_size'].input
    expect(schema.safeParse({ width: 800, height: 40 }).success).toBe(true)
    expect(schema.safeParse({ width: '800', height: 40 }).success).toBe(false)
    expect(schema.safeParse({ width: 800 }).success).toBe(false)
  })

  it('process_action requires a well-formed action item and defaults isFullScreen to false', () => {
    const schema = selectionRequestSchemas['selection.process_action'].input
    const minimalItem = { id: 'a1', name: 'Translate', enabled: true, isBuiltIn: true }

    const parsed = schema.safeParse({ actionItem: minimalItem })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.isFullScreen).toBe(false)

    // Missing a required action-item field fails validation.
    expect(schema.safeParse({ actionItem: { id: 'a1', name: 'x', enabled: true } }).success).toBe(false)
    // Optional fields are accepted when present.
    expect(
      schema.safeParse({ actionItem: { ...minimalItem, prompt: 'p', selectedText: 't' }, isFullScreen: true }).success
    ).toBe(true)
  })

  it('get_linux_env_info output describes the four boolean env flags', () => {
    const schema = selectionRequestSchemas['selection.get_linux_env_info'].output
    expect(
      schema.safeParse({
        isLinuxWaylandDisplay: false,
        isLinuxXWaylandMode: false,
        hasLinuxInputDeviceAccess: true,
        isLinuxCompositorCompatible: true
      }).success
    ).toBe(true)
    expect(schema.safeParse({ isLinuxWaylandDisplay: false }).success).toBe(false)
  })
})
