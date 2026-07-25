import '@testing-library/jest-dom/vitest'

import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  language: 'en-US',
  theme: 'light' as ThemeMode
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mocks.ipcRequest(...args)
  }
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: mocks.theme })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: mocks.language,
      resolvedLanguage: mocks.language
    }
  })
}))

import { buildPrivacyPolicyUrl, getPrivacyPolicyAsset, PrivacyPolicyDialog } from '../PrivacyPolicyDialog'

describe('privacy policy resource selection', () => {
  it.each(['zh-CN', 'zh-TW'])('uses the Chinese policy for %s', (language) => {
    expect(getPrivacyPolicyAsset(language)).toBe('privacy-zh.html')
  })

  it('uses the English policy for other languages', () => {
    expect(getPrivacyPolicyAsset('ja-JP')).toBe('privacy-en.html')
  })

  it('builds a Windows-safe dark theme file URL', () => {
    expect(buildPrivacyPolicyUrl('C:\\Program Files\\Cherry Studio\\resources', 'zh-TW', ThemeMode.dark)).toBe(
      'file:///C:/Program%20Files/Cherry%20Studio/resources/cherry-studio/privacy-zh.html?theme=dark'
    )
  })
})

describe('PrivacyPolicyDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.language = 'en-US'
    mocks.theme = ThemeMode.light
    mocks.ipcRequest.mockResolvedValue({ resourcesPath: '/Applications/Cherry Studio.app/Contents/Resources' })
  })

  it('loads the local policy with the active language and theme', async () => {
    render(<PrivacyPolicyDialog open onAccept={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTitle('privacy_policy.title')).toHaveAttribute(
        'src',
        'file:///Applications/Cherry%20Studio.app/Contents/Resources/cherry-studio/privacy-en.html?theme=light'
      )
    })
    expect(mocks.ipcRequest).toHaveBeenCalledWith('app.get_info')
  })

  it('offers both privacy choices during onboarding', () => {
    const onAccept = vi.fn()
    const onDecline = vi.fn()
    mocks.ipcRequest.mockImplementation(() => new Promise(() => {}))
    render(<PrivacyPolicyDialog open onAccept={onAccept} onDecline={onDecline} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.decline' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.i_know' }))

    expect(onDecline).toHaveBeenCalledTimes(1)
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Close')).not.toBeInTheDocument()
  })
})
