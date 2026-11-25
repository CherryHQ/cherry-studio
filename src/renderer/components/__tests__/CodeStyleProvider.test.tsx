import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCodeBlockPalette } from '@cherrystudio/ui/code-block'
import { loadCodeTheme } from '@cherrystudio/ui/code-highlight'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { useCodeStyle, useCodeStyleThemeCatalog } from '@renderer/hooks/useCodeStyle'

vi.unmock('@cherrystudio/ui')

const themeState = vi.hoisted(() => ({ theme: 'light' as 'light' | 'dark' }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: themeState.theme }) }))

function Probe() {
  const { codeBlockStyle, activeCodeTheme, isCodeThemeDark } = useCodeStyle()
  const { themeNames } = useCodeStyleThemeCatalog()
  return (
    <div aria-label="Code appearance" style={codeBlockStyle}>
      <output aria-label="Selected code theme">{activeCodeTheme}</output>
      <span>{isCodeThemeDark ? 'Dark code' : 'Light code'}</span>
      <select aria-label="Available code themes">
        {themeNames.map((name) => (
          <option key={name}>{name}</option>
        ))}
      </select>
    </div>
  )
}
const appearance = () => screen.getByLabelText('Code appearance')
describe('shared code appearance', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    themeState.theme = 'light'
  })

  it('keeps the message palette independent of the CodeMirror preference', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.viewer.theme_light': 'nord',
      'chat.code.editor.theme_light': 'dracula'
    })
    render(
      <CodeStyleProvider>
        <Probe />
      </CodeStyleProvider>
    )
    const palette = getCodeBlockPalette(await loadCodeTheme('nord'))
    await waitFor(() =>
      expect(appearance().style.getPropertyValue('--code-syntax-keyword')).toBe(palette['--code-syntax-keyword'])
    )
    expect(screen.getByLabelText('Selected code theme')).toHaveTextContent('nord')
    expect(screen.getByText('Dark code')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'dracula' })).toBeInTheDocument()
  })

  it('updates the palette when the app theme changes', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.viewer.theme_light': 'one-light',
      'chat.code.viewer.theme_dark': 'nord'
    })
    const { rerender } = render(
      <CodeStyleProvider>
        <Probe />
      </CodeStyleProvider>
    )
    const light = getCodeBlockPalette(await loadCodeTheme('one-light'))
    await waitFor(() =>
      expect(appearance().style.getPropertyValue('--code-background')).toBe(light['--code-background'])
    )
    themeState.theme = 'dark'
    rerender(
      <CodeStyleProvider>
        <Probe />
      </CodeStyleProvider>
    )
    const dark = getCodeBlockPalette(await loadCodeTheme('nord'))
    await waitFor(() =>
      expect(appearance().style.getPropertyValue('--code-background')).toBe(dark['--code-background'])
    )
    expect(screen.getByText('Dark code')).toBeInTheDocument()
  })

  it('falls back to a valid palette for a removed theme identifier', async () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.viewer.theme_light', 'theme-deleted-upstream')
    render(
      <CodeStyleProvider>
        <Probe />
      </CodeStyleProvider>
    )
    await waitFor(() => expect(screen.getByLabelText('Selected code theme')).toHaveTextContent('cherry'))
  })

  it('defaults to the transparent Cherry theme and follows the app mode without switching themes', async () => {
    const { rerender } = render(
      <CodeStyleProvider>
        <Probe />
      </CodeStyleProvider>
    )
    await waitFor(() =>
      expect(appearance().style.getPropertyValue('--code-background')).toBe(
        'var(--cherry-code-background, transparent)'
      )
    )
    expect(appearance().style.getPropertyValue('--code-syntax-keyword')).toMatch(/^var\(--cherry-code-keyword, /)
    expect(screen.getByText('Light code')).toBeInTheDocument()

    themeState.theme = 'dark'
    rerender(
      <CodeStyleProvider>
        <Probe />
      </CodeStyleProvider>
    )
    expect(screen.getByLabelText('Selected code theme')).toHaveTextContent('cherry')
    expect(screen.getByText('Dark code')).toBeInTheDocument()
  })
})
