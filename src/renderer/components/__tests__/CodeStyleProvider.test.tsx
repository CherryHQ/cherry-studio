import type * as codeEditorUtils from '@cherrystudio/ui/components/composites/code-editor/utils'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { useCodeStyle, useCodeStyleThemeCatalog } from '@renderer/hooks/useCodeStyle'
import { shikiStreamService } from '@renderer/services/ShikiStreamService'
import { getShiki } from '@renderer/utils/shiki'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    highlightCodeToHtml: vi.fn(),
    highlightStreamingCode: vi.fn(),
    cleanupTokenizers: vi.fn(),
    getShikiPreProperties: vi.fn()
  }
}))

vi.mock('@renderer/utils/shiki', () => ({
  getShiki: vi.fn(async () => ({
    bundledThemesInfo: [
      { id: 'one-light', displayName: 'One Light', type: 'light' },
      { id: 'nord', displayName: 'Nord', type: 'dark' }
    ]
  })),
  getHighlighter: vi.fn(),
  getMarkdownIt: vi.fn(),
  loadLanguageAndThemeIfNeeded: vi.fn()
}))

const Probe = () => {
  const { highlightCode, activeCmTheme, activeShikiTheme } = useCodeStyle()
  const { loadThemeNames, themeNames } = useCodeStyleThemeCatalog()
  return (
    <>
      <span data-testid="has-dracula">{String(themeNames.includes('dracula'))}</span>
      <span data-testid="cm-theme-type">{typeof activeCmTheme}</span>
      <span data-testid="cm-theme-string">{typeof activeCmTheme === 'string' ? activeCmTheme : ''}</span>
      <span data-testid="shiki-theme">{activeShikiTheme}</span>
      <button type="button" onClick={() => void loadThemeNames()}>
        Load themes
      </button>
      <button type="button" onClick={() => void highlightCode('value', 'missing-language')}>
        Highlight code
      </button>
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

  it('throws when useCodeStyle is used outside CodeStyleProvider', () => {
    expect(() => render(<Probe />)).toThrow('useCodeStyle must be used within a CodeStyleProvider')
  })

  it('provides cm theme names and resolves the saved cm theme when code editor is enabled', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'dracula')

    renderProvider()
    fireEvent.click(screen.getByRole('button', { name: 'Load themes' }))

    // The first waitFor in this file pays the real (cold) dynamic import of
    // @uiw/codemirror-themes-all; under a fully loaded worker pool that takes
    // several seconds, so it needs more than the 1s waitFor default. Later
    // tests reuse the module-level cmThemesPromise cache and stay fast.
    await waitFor(
      () => {
        expect(screen.getByTestId('has-dracula').textContent).toBe('true')
        expect(screen.getByTestId('cm-theme-type').textContent).toBe('object')
      },
      { timeout: 15000 }
    )
  })

  it('resolves basic string cm themes without loading a themes-all extension', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'dark')

    renderProvider()

    await waitFor(() => {
      expect(screen.getByTestId('cm-theme-string').textContent).toBe('dark')
    })
  })

  it('does not load shiki until its theme catalog is requested', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', false)

    renderProvider()

    expect(vi.mocked(getShiki)).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Load themes' }))
    await waitFor(() => expect(vi.mocked(getShiki)).toHaveBeenCalledOnce())
  })

  // Notes, MCP editors, ArtifactPane and the previews all read activeCmTheme; gating its
  // resolution on the chat-only flag left them on the bare light/dark theme.
  it('resolves a real cm theme for non-chat editors while the chat code editor is disabled', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', false)
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'dracula')

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('cm-theme-type').textContent).toBe('object'), { timeout: 15000 })
  })

  // AgentFileDiffRenderer reads activeShikiTheme synchronously and hands it to a resolver that
  // throws on an unknown id, without ever asking the provider to load its catalog.
  it('never hands a stale shiki id to consumers that do not load the catalog themselves', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.viewer.theme_light', 'theme-deleted-upstream')

    renderProvider()

    expect(screen.getByTestId('shiki-theme').textContent).toBe('one-light')
    await waitFor(() => expect(vi.mocked(getShiki)).toHaveBeenCalled())
    expect(screen.getByTestId('shiki-theme').textContent).toBe('one-light')
  })

  it('activates a stored shiki theme once the catalog confirms it', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.viewer.theme_light', 'nord')

    renderProvider()

    expect(screen.getByTestId('shiki-theme').textContent).toBe('one-light')
    await waitFor(() => expect(screen.getByTestId('shiki-theme').textContent).toBe('nord'))
  })

  it('routes one-shot highlights through the stream service instead of the main thread', async () => {
    vi.mocked(shikiStreamService.highlightCodeToHtml).mockResolvedValue('<pre>value</pre>')

    renderProvider()
    fireEvent.click(screen.getByRole('button', { name: 'Highlight code' }))

    await waitFor(() =>
      expect(shikiStreamService.highlightCodeToHtml).toHaveBeenCalledWith('value', 'missing-language', 'one-light')
    )
  })
})
