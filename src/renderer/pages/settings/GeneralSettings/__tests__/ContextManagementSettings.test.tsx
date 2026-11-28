import '@testing-library/jest-dom/vitest'
import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import { MIN_COMPRESS_THRESHOLD_PERCENT, MIN_TRUNCATE_THRESHOLD } from '@shared/data/types/contextSettings'

vi.mock('@data/hooks/usePreference', async (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('@renderer/hooks/useModel', () => ({ useModelById: () => ({ model: undefined }) }))
vi.mock('@renderer/hooks/useProvider', () => ({ useProviders: () => ({ providers: [] }) }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: i18next.t.bind(i18next) }) }))
vi.mock('@renderer/components/DefaultModelSelector', () => ({ DefaultModelSelector: () => null }))

import { ContextManagementSettings } from '../ContextManagementSettings'

const label = (suffix: string) => i18next.t('settings.models.context_management.' + suffix)
const edit = async (user: ReturnType<typeof userEvent.setup>, name: string, value: string) => {
  const input = screen.getByRole('spinbutton', { name })
  await user.clear(input)
  if (value) await user.type(input, value)
  await user.tab()
}

describe('ContextManagementSettings', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18next.init({
      lng: 'en',
      resources: { en: { translation: en } },
      keySeparator: false,
      interpolation: { escapeValue: false }
    })
    Object.entries({
      'chat.context_settings.enabled': true,
      'chat.context_settings.max_messages': null,
      'chat.context_settings.compress_window': null,
      'chat.context_settings.truncate_threshold': 50_000,
      'chat.context_settings.compress.enabled': true,
      'chat.context_settings.compress.model_id': null,
      'chat.context_settings.compress.threshold_percent': 80
    }).forEach(([key, value]) => mockPreferenceState.set(key, value))
  })

  it('writes the message limit and clears it back to unlimited', async () => {
    render(<ContextManagementSettings />)
    const input = screen.getByLabelText(label('max_messages'))
    fireEvent.change(input, { target: { value: '5' } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(mockPreferenceState.get('chat.context_settings.max_messages')).toBe(5)
    fireEvent.change(input, { target: { value: '' } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(mockPreferenceState.get('chat.context_settings.max_messages')).toBeNull()
  })

  it('writes the master switch preference', () => {
    mockPreferenceState.set('chat.context_settings.enabled', false)
    render(<ContextManagementSettings />)
    fireEvent.click(screen.getByRole('switch', { name: label('enabled') }))
    expect(mockPreferenceState.get('chat.context_settings.enabled')).toBe(true)
  })

  it('floors the threshold and clamps it to the fs_read-safe minimum', async () => {
    render(<ContextManagementSettings />)
    const input = screen.getByLabelText(label('truncate_threshold'))
    fireEvent.change(input, { target: { value: '80000.7' } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(mockPreferenceState.get('chat.context_settings.truncate_threshold')).toBe(80_000)
    fireEvent.change(input, { target: { value: '-5' } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(mockPreferenceState.get('chat.context_settings.truncate_threshold')).toBe(MIN_TRUNCATE_THRESHOLD)
  })

  it('writes the compaction trigger and clamps it into range', async () => {
    render(<ContextManagementSettings />)
    const input = screen.getByLabelText(label('compress_threshold'))
    fireEvent.change(input, { target: { value: '60' } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(mockPreferenceState.get('chat.context_settings.compress.threshold_percent')).toBe(60)
    fireEvent.change(input, { target: { value: '0' } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(mockPreferenceState.get('chat.context_settings.compress.threshold_percent')).toBe(
      MIN_COMPRESS_THRESHOLD_PERCENT
    )
    fireEvent.change(input, { target: { value: '250' } })
    await act(async () => {
      fireEvent.blur(input)
    })
    expect(mockPreferenceState.get('chat.context_settings.compress.threshold_percent')).toBe(100)
  })

  // Catches an invalid B being persisted, or the disable action retaining the old window.
  it('saves a valid round window, rejects B <= A, and turns the window off', async () => {
    const user = userEvent.setup()
    mockPreferenceState.set('chat.context_settings.max_messages', 3)
    render(<ContextManagementSettings />)
    await user.click(screen.getByRole('switch', { name: label('window_enabled') }))
    expect(mockPreferenceState.get('chat.context_settings.compress_window')).toBe(4)
    await edit(user, label('window_rounds'), '3')
    expect(mockPreferenceState.get('chat.context_settings.compress_window')).toBe(4)
    expect(screen.getByRole('alert')).toHaveTextContent(label('window_invalid'))
    await edit(user, label('window_rounds'), '7')
    expect(mockPreferenceState.get('chat.context_settings.compress_window')).toBe(7)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: label('window_enabled') }))
    expect(mockPreferenceState.get('chat.context_settings.compress_window')).toBeNull()
  })

  // Catches enabling without A, or invalidating B by changing/clearing A later.
  it('rejects fractional window and zero recent drafts without coercing saved bounds', async () => {
    mockPreferenceState.set('chat.context_settings.max_messages', 3)
    mockPreferenceState.set('chat.context_settings.compress_window', 6)
    const user = userEvent.setup()
    render(<ContextManagementSettings />)
    await edit(user, label('window_rounds'), '7.5')
    expect(mockPreferenceState.get('chat.context_settings.compress_window')).toBe(6)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await edit(user, label('window_recent'), '0')
    expect(mockPreferenceState.get('chat.context_settings.max_messages')).toBe(3)
  })

  it('requires a finite recent limit and protects an enabled window when A changes', async () => {
    const user = userEvent.setup()
    render(<ContextManagementSettings />)
    await user.click(screen.getByRole('switch', { name: label('window_enabled') }))
    expect(mockPreferenceState.get('chat.context_settings.compress_window')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(label('window_invalid'))
    await edit(user, label('max_messages'), '5')
    await user.click(screen.getByRole('switch', { name: label('window_enabled') }))
    expect(mockPreferenceState.get('chat.context_settings.compress_window')).toBe(6)
    await edit(user, label('window_recent'), '6')
    expect(mockPreferenceState.get('chat.context_settings.max_messages')).toBe(5)
    await edit(user, label('window_recent'), '')
    expect(mockPreferenceState.get('chat.context_settings.max_messages')).toBe(5)
    expect(screen.getByRole('alert')).toHaveTextContent(label('window_invalid'))
  })
})
