import type * as codeEditorUtils from '@cherrystudio/ui/components/composites/code-editor/utils'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Override the global lightweight '@cherrystudio/ui' stand-in with the real theme
// utils — this test locks the provider + theme-resolution behavior end-to-end.
vi.mock('@cherrystudio/ui', async () => {
  const utils = await vi.importActual<typeof codeEditorUtils>(
    '@cherrystudio/ui/components/composites/code-editor/utils'
  )
  return {
    getCmThemeNames: utils.getCmThemeNames,
    getCmThemeByName: utils.getCmThemeByName
  }
})

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/hooks/useMermaid', () => ({
  useMermaid: () => {}
}))

vi.mock('@renderer/services/ShikiStreamService', () => ({
  shikiStreamService: {
    dispose: vi.fn(),
    highlightCodeChunk: vi.fn(),
    highlightStreamingCode: vi.fn(),
    cleanupTokenizers: vi.fn(),
    getShikiPreProperties: vi.fn()
  }
}))

vi.mock('@renderer/utils/shiki', () => ({
  getShiki: vi.fn(async () => ({ bundledThemesInfo: [{ id: 'one-light', displayName: 'One Light', type: 'light' }] })),
  getHighlighter: vi.fn(),
  getMarkdownIt: vi.fn(),
  loadLanguageIfNeeded: vi.fn(),
  loadThemeIfNeeded: vi.fn()
}))

const Probe = () => {
  const { themeNames, activeCmTheme } = useCodeStyle()
  return (
    <>
      <span data-testid="has-dracula">{String(themeNames.includes('dracula'))}</span>
      <span data-testid="cm-theme-type">{typeof activeCmTheme}</span>
      <span data-testid="cm-theme-string">{typeof activeCmTheme === 'string' ? activeCmTheme : ''}</span>
    </>
  )
}

const renderProvider = () =>
  render(
    <CodeStyleProvider>
      <Probe />
    </CodeStyleProvider>
  )

describe('CodeStyleProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
  })

  it('provides cm theme names and resolves the saved cm theme when code editor is enabled', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'dracula')

    renderProvider()

    // The first waitFor in this file pays the real (cold) dynamic import of
    // @uiw/codemirror-themes-all; under a fully loaded worker pool that takes
    // several seconds, so it needs more than the 1s waitFor default. The later
    // tests reuse the module-level theme cache but got the same bound anyway —
    // the S6 icon-graph probes raise pool pressure enough that even cached
    // runs have been observed past 1s.
    await waitFor(
      () => {
        expect(screen.getByTestId('has-dracula').textContent).toBe('true')
        expect(screen.getByTestId('cm-theme-type').textContent).toBe('object')
      },
      { timeout: 15_000 }
    )
  }, 45_000)

  it('resolves basic string cm themes without loading a themes-all extension', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'dark')

    renderProvider()

    await waitFor(
      () => {
        expect(screen.getByTestId('cm-theme-string').textContent).toBe('dark')
      },
      { timeout: 15_000 }
    )
  }, 45_000)

  it('falls back to shiki theme names when code editor is disabled', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', false)

    renderProvider()

    await waitFor(
      () => {
        expect(screen.getByTestId('has-dracula').textContent).toBe('false')
        expect(screen.getByTestId('cm-theme-type').textContent).toBe('object')
      },
      { timeout: 15_000 }
    )
  }, 45_000)
})
