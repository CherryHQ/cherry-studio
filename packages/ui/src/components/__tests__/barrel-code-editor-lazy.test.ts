/**
 * Barrel contract for #19208: the ui barrel must NOT re-export the CodeEditor
 * component. The editor statically pulls the whole CodeMirror stack, so a
 * barrel re-export would load it into every static graph that touches the
 * barrel — including read-only chat markdown. The component stays reachable
 * only through the deep path ('@cherrystudio/ui/components/composites/
 * code-editor'), which app code imports lazily (LazyCodeEditor).
 *
 * Types and the theme getters stay on the barrel: types vanish at build time,
 * and the theme utils dynamically import the heavy theme bundle themselves.
 */
import { describe, expect, it } from 'vitest'

import * as Barrel from '../index'

describe('ui barrel keeps the CodeMirror stack lazy (#19208)', () => {
  it('does not re-export the CodeEditor component', () => {
    expect((Barrel as Record<string, unknown>).CodeEditor).toBeUndefined()
  })

  it('keeps the light editor surface on the barrel: types plus theme getters', () => {
    // Theme getters are runtime values and must survive the split.
    expect(typeof Barrel.getCmThemeByName).toBe('function')
    expect(typeof Barrel.getCmThemeNames).toBe('function')
  })

  it('still exposes the editor through the deep path for lazy importers', async () => {
    const mod = await import('../composites/code-editor')
    // memo-wrapped: a callable-or-memo object, but never undefined
    expect(mod.default).toBeDefined()
  })
})
