import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ComposerSurface, { type ComposerSurfaceProps } from '../ComposerSurface'

vi.mock('@renderer/services/voice', () => ({ voiceTargetManager: {} }))
vi.mock('@renderer/components/SendMessageButton', () => ({ default: () => <button type="button">Send</button> }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'chat.input.ai_disclaimer' ? '内容由 AI 生成，仅供参考' : key)
  })
}))

vi.mock('../ComposerSurfaceRuntime', () => new Promise(() => {}))

function Harness(overrides: Partial<ComposerSurfaceProps> = {}) {
  const [text, setText] = useState('')
  const props: ComposerSurfaceProps = {
    text,
    onTextChange: setText,
    tokens: [],
    managedTokenKinds: [],
    onTokensChange: vi.fn(),
    placeholder: 'Message',
    sendMessageShortcut: ['Enter'],
    sendDisabled: false,
    isLoading: false,
    onSendDraft: vi.fn(),
    onPause: vi.fn(),
    supportedExts: [],
    setFiles: vi.fn(),
    filesCount: 0,
    isExpanded: false,
    onExpandedChange: vi.fn(),
    quickPanelEnabled: true,
    enableDragDrop: true,
    enableSpellCheck: true,
    fontSize: 14,
    narrowMode: true,
    renderLeftControls: () => <span>Composer tools</span>,
    ...overrides
  }

  return <ComposerSurface {...props} />
}

describe('deferred ComposerSurface', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it.each(['off', 'ctrl_arrow'])('history recall policy %s rejects plain Up before runtime loads', (mode) => {
    MockUsePreferenceUtils.setPreferenceValue('chat.input.history_recall', mode)
    const onInputHistoryNavigate = vi.fn(() => true)
    render(<Harness text="" onInputHistoryNavigate={onInputHistoryNavigate} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(true)
    expect(onInputHistoryNavigate).not.toHaveBeenCalled()
  })

  it('recalls history with keypad Up under the default policy before runtime loads', () => {
    const onInputHistoryNavigate = vi.fn(() => true)
    render(<Harness text="" onInputHistoryNavigate={onInputHistoryNavigate} />)
    const input = screen.getByRole('textbox', { name: 'Message' })

    expect(fireEvent.keyDown(input, { key: 'ArrowUp', code: 'Numpad8' })).toBe(false)
    expect(onInputHistoryNavigate).toHaveBeenCalledWith('up')
  })

  it('leaves keypad Up unhandled when history recall is off before runtime loads', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.input.history_recall', 'off')
    const onInputHistoryNavigate = vi.fn(() => true)
    render(<Harness text="" onInputHistoryNavigate={onInputHistoryNavigate} />)
    const input = screen.getByRole('textbox', { name: 'Message' })

    expect(fireEvent.keyDown(input, { key: 'ArrowUp', code: 'Numpad8' })).toBe(true)
    expect(onInputHistoryNavigate).not.toHaveBeenCalled()
  })

  it('history recall policy applies before the lazy runtime resolves and changes on rerender', () => {
    const onInputHistoryNavigate = vi.fn(() => true)
    const props = { text: '', onInputHistoryNavigate }
    const { rerender } = render(<Harness {...props} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    const press = (init: KeyboardEventInit = {}) => {
      const count = onInputHistoryNavigate.mock.calls.length
      const allowed = fireEvent.keyDown(input, { key: 'ArrowUp', ...init })
      return { called: onInputHistoryNavigate.mock.calls.length > count, allowed }
    }
    expect(press()).toEqual({ called: true, allowed: false })
    MockUsePreferenceUtils.setPreferenceValue('chat.input.history_recall', 'off')
    rerender(<Harness {...props} />)
    expect(press()).toEqual({ called: false, allowed: true })
    expect(press({ ctrlKey: true })).toEqual({ called: false, allowed: true })
    MockUsePreferenceUtils.setPreferenceValue('chat.input.history_recall', 'ctrl_arrow')
    rerender(<Harness {...props} />)
    expect(press()).toEqual({ called: false, allowed: true })
    expect(press({ ctrlKey: true })).toEqual({ called: true, allowed: false })
    expect(press({ ctrlKey: true, altKey: true })).toEqual({ called: false, allowed: true })
    expect(press({ metaKey: true })).toEqual({ called: false, allowed: true })
    expect(screen.getByRole('textbox', { name: 'Message' })).toBe(input)
    expect(screen.queryByTestId('composer-runtime')).toBeNull()
  })
})
