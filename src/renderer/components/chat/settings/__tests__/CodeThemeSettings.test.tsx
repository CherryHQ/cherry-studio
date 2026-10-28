import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'

import ChatPreferenceSections from '../ChatPreferenceSections'

vi.unmock('@cherrystudio/ui')
const appearance = vi.hoisted(() => ({ theme: 'light' }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => appearance }))

const browserMethods = ['hasPointerCapture', 'scrollIntoView'] as const
const descriptors = browserMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name))
beforeAll(() => {
  for (const name of browserMethods)
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: () => false })
})
afterAll(() => {
  browserMethods.forEach((name, index) => {
    const descriptor = descriptors[index]
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  })
})

beforeEach(() => {
  MockUsePreferenceUtils.resetMocks()
  appearance.theme = 'light'
})

// CodeMirror controls must remain available with message editing disabled and write only their own preference.
it('saves separate CodeMirror and viewer themes for the current app appearance', async () => {
  MockUsePreferenceUtils.setMultiplePreferenceValues({
    'chat.code.editor.enabled': false,
    'chat.code.editor.theme_light': 'dracula',
    'chat.code.editor.theme_dark': 'githubDark',
    'chat.code.viewer.theme_light': 'one-light',
    'chat.code.viewer.theme_dark': 'nord'
  })
  const user = userEvent.setup()
  const surface = () => (
    <CodeStyleProvider>
      <ChatPreferenceSections />
    </CodeStyleProvider>
  )
  const host = render(surface())
  const editorTheme = () => screen.getByRole('combobox', { name: '代码编辑器' })
  await waitFor(() => expect(editorTheme()).toHaveTextContent('dracula'))
  await user.click(editorTheme())
  await user.click(await screen.findByRole('option', { name: 'githubDark' }))
  await waitFor(() =>
    expect(MockUsePreferenceUtils.getPreferenceValue('chat.code.editor.theme_light')).toBe('githubDark')
  )
  expect(MockUsePreferenceUtils.getPreferenceValue('chat.code.viewer.theme_light')).toBe('one-light')

  appearance.theme = 'dark'
  host.rerender(surface())
  await waitFor(() => expect(editorTheme()).toHaveTextContent('githubDark'))
  await user.click(editorTheme())
  await user.click(await screen.findByRole('option', { name: 'dracula' }))
  await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('chat.code.editor.theme_dark')).toBe('dracula'))
  expect(MockUsePreferenceUtils.getPreferenceValue('chat.code.editor.theme_light')).toBe('githubDark')
  expect(MockUsePreferenceUtils.getPreferenceValue('chat.code.viewer.theme_dark')).toBe('nord')
})
