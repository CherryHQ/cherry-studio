import { describe, expect, it } from 'vitest'

import { WindowType } from '../types'
import { WINDOW_TYPE_REGISTRY } from '../windowRegistry'

// On macOS, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` without
// `skipTransformProcessType: true` runs TransformProcessType(UIElement) inside Electron,
// deactivating the whole app (all windows drop behind the frontmost app) and removing
// the Dock icon. applyWindowBehavior executes the registry declaration on every window
// creation, so every entry opting into visibleOnFullScreen must skip the transform.
describe('WINDOW_TYPE_REGISTRY behavior invariants', () => {
  it('every visibleOnFullScreen declaration skips the macOS process transform', () => {
    for (const entry of Object.values(WINDOW_TYPE_REGISTRY)) {
      if (!entry) continue
      const declaration = entry.behavior?.visibleOnAllWorkspaces
      if (declaration?.visibleOnFullScreen) {
        expect(declaration.skipTransformProcessType, `WindowType '${entry.type}'`).toBe(true)
      }
    }
  })

  it('SelectionToolbar and QuickAssistant declare the flag (regression: enabling selection assistant hid the app)', () => {
    for (const type of [WindowType.SelectionToolbar, WindowType.QuickAssistant]) {
      expect(
        WINDOW_TYPE_REGISTRY[type]?.behavior?.visibleOnAllWorkspaces?.skipTransformProcessType,
        `WindowType '${type}'`
      ).toBe(true)
    }
  })
})

// The shared preload bundle is code-split, and Electron's sandbox blocks a preload from
// requiring its own chunks — it fails with "module not found: ./chunks/…". The window then
// loads without `window.api`, so the renderer throws while initialising and never mounts.
// On an ordinary window that reads as a blank page; on the screenshot overlay it produced a
// transparent, always-on-top, click-swallowing window that could only be force-quit.
describe('WINDOW_TYPE_REGISTRY preload invariants', () => {
  it('every window using the shared preload disables the sandbox', () => {
    for (const entry of Object.values(WINDOW_TYPE_REGISTRY)) {
      if (!entry) continue
      // `preload: ''` opts out of a preload entirely and may stay sandboxed; omitting the
      // field means the default 'preload.js', which may not.
      if (entry.preload === '') continue
      expect(entry.windowOptions.webPreferences?.sandbox, `WindowType '${entry.type}'`).toBe(false)
    }
  })
})
