import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as codeEditorUtils from '@cherrystudio/ui/components/composites/code-editor/utils'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { useCmTheme, useCodeStyle, useCodeStyleThemeCatalog } from '@renderer/hooks/useCodeStyle'

// Resolve actual CodeMirror theme extensions through the provider.
vi.mock('@cherrystudio/ui', async () => {
  const utils = await vi.importActual<typeof codeEditorUtils>(
    '@cherrystudio/ui/components/composites/code-editor/utils'
  )
  return {
    getCmThemeNames: utils.getCmThemeNames,
    getCmThemeByName: utils.getCmThemeByName
  }
})

const themeState = vi.hoisted(() => ({ theme: 'light' as 'light' | 'dark' }))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: themeState.theme })
}))

vi.mock('@renderer/hooks/useMermaid', () => ({
  useMermaid: () => {}
}))

const Probe = () => {
  const { highlightCode, activeCodeTheme } = useCodeStyle()
  const { loadThemeNames, themeNames, loadCmThemeNames, cmThemeNames } = useCodeStyleThemeCatalog()
  return (
    <>
      <span data-testid="has-dracula">{String(themeNames.includes('dracula'))}</span>
      <span data-testid="has-cm-theme">{String(themeNames.includes('githubDark'))}</span>
      <span data-testid="cm-catalog-loaded">{String(cmThemeNames.includes('githubDark'))}</span>
      <span data-testid="shiki-theme">{activeCodeTheme}</span>
      <button type="button" onClick={() => void loadThemeNames()}>
        Load themes
      </button>
      <button type="button" onClick={() => void loadCmThemeNames()}>
        Load editor themes
      </button>
      <button type="button" onClick={() => void highlightCode('value', 'missing-language')}>
        Highlight code
      </button>
    </>
  )
}

// A remaining CodeMirror consumer such as Notes or a configuration editor.
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

  it('does not demand the theme while the editor boundary is inactive', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'dracula')

    const { rerender } = renderProvider(<EditorBoundary active={false} />)
    expect(screen.getByTestId('cm-theme-string').textContent).toBe('light')

    rerender(
      <CodeStyleProvider>
        <EditorBoundary />
      </CodeStyleProvider>
    )

    await waitFor(() => expect(screen.getByTestId('cm-theme-type').textContent).toBe('object'), { timeout: 15000 })
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
    fireEvent.click(screen.getByRole('button', { name: 'Load editor themes' }))

    // The first waitFor in this file pays the real (cold) dynamic import of
    // @uiw/codemirror-themes-all; under a fully loaded worker pool that takes
    // several seconds, so it needs more than the 1s waitFor default. Later
    // tests reuse the module-level cmThemesPromise cache and stay fast.
    await waitFor(
      () => {
        expect(screen.getByTestId('has-dracula').textContent).toBe('true')
        expect(screen.getByTestId('cm-catalog-loaded').textContent).toBe('true')
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

  // Notes and configuration editors demand their theme independently of the message-editor switch.
  it('resolves a real cm theme for non-chat editors while the chat code editor is disabled', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', false)
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.theme_light', 'dracula')

    renderProvider(<EditorBoundary />)

    await waitFor(() => expect(screen.getByTestId('cm-theme-type').textContent).toBe('object'), { timeout: 15000 })
  })

  it('keeps the viewer catalog separate from CodeMirror and preserves saved themes', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('chat.code.viewer.theme_light', 'nord')
    renderProvider()
    expect(screen.getByTestId('has-dracula').textContent).toBe('true')
    expect(screen.getByTestId('shiki-theme').textContent).toBe('nord')
    expect(screen.getByTestId('has-cm-theme').textContent).toBe('false')
  })

  it('falls back for removed themes before any consumer requests highlighting', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.viewer.theme_light', 'theme-deleted-upstream')
    renderProvider()
    expect(screen.getByTestId('shiki-theme').textContent).toBe('one-light')
  })
})
