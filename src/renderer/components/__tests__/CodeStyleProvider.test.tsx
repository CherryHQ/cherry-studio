import { getCmThemeByName } from '@cherrystudio/ui'
import type * as codeEditorUtils from '@cherrystudio/ui/components/composites/code-editor/utils'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { useCmTheme, useCodeStyle, useCodeStyleThemeCatalog } from '@renderer/hooks/useCodeStyle'
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
    getCmThemeByName: vi.fn((name: string) => utils.getCmThemeByName(name))
  }
})

const themeState = vi.hoisted(() => ({ theme: 'light' as 'light' | 'dark' }))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: themeState.theme })
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
  const { highlightCode, activeShikiTheme } = useCodeStyle()
  const { loadThemeNames, themeNames } = useCodeStyleThemeCatalog()
  return (
    <>
      <span data-testid="has-dracula">{String(themeNames.includes('dracula'))}</span>
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

// Stands in for any CodeMirror consumer boundary (Notes, MCP editors, ArtifactPane, previews).
const EditorBoundary = ({ active = true }: { active?: boolean }) => {
  const theme = useCmTheme(active)
  return (
    <>
      <span data-testid="cm-theme-type">{typeof theme}</span>
      <span data-testid="cm-theme-string">{typeof theme === 'string' ? theme : ''}</span>
    </>
  )
}

const renderProvider = (children: React.ReactNode = <Probe />) =>
  render(<CodeStyleProvider>{children}</CodeStyleProvider>)

describe('CodeStyleProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    themeState.theme = 'light'
  })

  it('throws when useCodeStyle is used outside CodeStyleProvider', () => {
    expect(() => render(<Probe />)).toThrow('useCodeStyle must be used within a CodeStyleProvider')
  })

  it('does not resolve the cm theme while no editor boundary is mounted', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'dracula')

    renderProvider()

    // Mounting the provider alone must not pull the themes-all catalog; only an
    // editor boundary (useCmTheme) may trigger resolution.
    expect(vi.mocked(getCmThemeByName)).not.toHaveBeenCalled()
  })

  it('does not demand the theme while the editor boundary is inactive', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'dracula')

    const { rerender } = renderProvider(<EditorBoundary active={false} />)
    expect(vi.mocked(getCmThemeByName)).not.toHaveBeenCalled()

    rerender(
      <CodeStyleProvider>
        <EditorBoundary />
      </CodeStyleProvider>
    )

    await waitFor(() => expect(vi.mocked(getCmThemeByName)).toHaveBeenCalledWith('dracula'))
  })

  it('resolves the saved cm theme once an editor boundary demands it', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'dracula')

    renderProvider(
      <>
        <Probe />
        <EditorBoundary />
      </>
    )
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

    renderProvider(<EditorBoundary />)

    await waitFor(() => {
      expect(screen.getByTestId('cm-theme-string').textContent).toBe('dark')
    })
  })

  // Notes, MCP editors, ArtifactPane and the previews all read the cm theme; gating its
  // resolution on the chat-only flag left them on the bare light/dark theme.
  it('resolves a real cm theme for non-chat editors while the chat code editor is disabled', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', false)
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'dracula')

    renderProvider(<EditorBoundary />)

    await waitFor(() => expect(screen.getByTestId('cm-theme-type').textContent).toBe('object'), { timeout: 15000 })
  })

  it('falls back to the base material light theme when the stored name is auto', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'auto')

    renderProvider(<EditorBoundary />)

    await waitFor(() => expect(vi.mocked(getCmThemeByName)).toHaveBeenCalledWith('materialLight'))
  })

  it('re-resolves with the dark-side theme when the window theme flips', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'dracula')
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_dark', 'githubDark')

    const { rerender } = renderProvider(<EditorBoundary />)
    await waitFor(() => expect(vi.mocked(getCmThemeByName)).toHaveBeenCalledWith('dracula'))

    themeState.theme = 'dark'
    rerender(
      <CodeStyleProvider>
        <EditorBoundary />
      </CodeStyleProvider>
    )

    await waitFor(() => expect(vi.mocked(getCmThemeByName)).toHaveBeenCalledWith('githubDark'))
  })

  it('does not load shiki until its theme catalog is requested', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', false)

    renderProvider()

    expect(vi.mocked(getShiki)).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Load themes' }))
    await waitFor(() => expect(vi.mocked(getShiki)).toHaveBeenCalledOnce())
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
