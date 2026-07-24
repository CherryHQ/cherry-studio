import '@testing-library/jest-dom/vitest'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'
import {
  mockUseMultiplePreferences,
  mockUsePreference,
  MockUsePreferenceUtils
} from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const responsiveStyles = readFileSync(join(process.cwd(), 'src/renderer/assets/styles/responsive.css'), 'utf8')

const addApiKeyMock = vi.fn()
const updateProviderMock = vi.fn()
const oauthWithCherryInMock = vi.fn()
const syncProviderModelsMock = vi.fn()
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()
const modelSettingsPropsMock = vi.fn()
const dataApiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn()
}))
const i18nMock = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
  language: 'en-US',
  resolvedLanguage: 'en-US'
}))
const enabledProvidersMock: Array<{ id: string; isEnabled: boolean }> = []
const enabledModelsMock: Array<{ id: string; providerId: string; isEnabled: boolean }> = []
const selectedModelsMock: {
  defaultModel?: { id: string; providerId: string }
  quickModel?: { id: string; providerId: string }
  translateModel?: { id: string; providerId: string }
} = {}
const defaultUsePreferenceImplementation = mockUsePreference.getMockImplementation()
const defaultUseMultiplePreferencesImplementation = mockUseMultiplePreferences.getMockImplementation()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: dataApiMocks
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: i18nMock
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({
    addApiKey: addApiKeyMock,
    updateProvider: updateProviderMock
  }),
  useProviders: () => ({ providers: enabledProvidersMock, isLoading: false })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => selectedModelsMock,
  useModels: () => ({ models: enabledModelsMock, isLoading: false })
}))

vi.mock('@renderer/services/oauth', () => ({
  oauthWithCherryIn: (...args: unknown[]) => oauthWithCherryInMock(...args)
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args)
  }
}))

vi.mock('@renderer/components/WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />
}))

vi.mock('@renderer/pages/settings/ProviderSettings', () => ({
  ProviderSettingsPage: ({ isOnboarding }: { isOnboarding?: boolean }) => (
    <div data-testid="provider-settings" data-onboarding={String(isOnboarding)} />
  ),
  useProviderModelSync: () => ({
    syncProviderModels: syncProviderModelsMock,
    isSyncingModels: false
  })
}))

vi.mock('@renderer/pages/settings/ModelSettings/ModelSettings', () => ({
  default: (props: {
    autoFillEmptyModels?: boolean
    modelFilter?: (model: { providerId: string }) => boolean
    onDefaultModelSelected?: (model: { id: string; providerId: string }) => void | Promise<void>
    showPaintingModel?: boolean
  }) => {
    modelSettingsPropsMock(props)
    return <div data-testid="model-settings" />
  }
}))

vi.mock('../../privacy/PrivacyPolicyDialog', () => ({
  PrivacyPolicyDialog: ({
    open,
    onAccept,
    onDecline
  }: {
    open: boolean
    onAccept: () => void
    onDecline?: () => void
  }) =>
    open ? (
      <div data-testid="privacy-policy-dialog">
        <button type="button" onClick={onAccept}>
          accept-policy
        </button>
        <button type="button" onClick={onDecline}>
          decline-policy
        </button>
      </div>
    ) : null
}))

import OnboardingPage from '../OnboardingPage'

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    if (defaultUsePreferenceImplementation) {
      mockUsePreference.mockImplementation(defaultUsePreferenceImplementation)
    }
    if (defaultUseMultiplePreferencesImplementation) {
      mockUseMultiplePreferences.mockImplementation(defaultUseMultiplePreferencesImplementation)
    }
    MockUsePreferenceUtils.resetMocks()
    i18nMock.changeLanguage.mockResolvedValue(undefined)
    oauthWithCherryInMock.mockResolvedValue('sk-test')
    addApiKeyMock.mockResolvedValue(undefined)
    updateProviderMock.mockResolvedValue(undefined)
    syncProviderModelsMock.mockResolvedValue([{ id: 'cherryin::gpt-4o-mini', providerId: 'cherryin', isEnabled: true }])
    enabledProvidersMock.splice(0, enabledProvidersMock.length, { id: 'openai', isEnabled: true })
    enabledModelsMock.splice(0, enabledModelsMock.length, {
      id: 'openai::gpt-4o-mini',
      providerId: 'openai',
      isEnabled: true
    })
    selectedModelsMock.defaultModel = { id: 'default-model', providerId: 'openai' }
    selectedModelsMock.quickModel = { id: 'quick-model', providerId: 'openai' }
    selectedModelsMock.translateModel = { id: 'translate-model', providerId: 'openai' }
    MockUsePreferenceUtils.setPreferenceValue('app.onboarding.provider_setup.status', 'pending')
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.data_collection.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', LATEST_PRIVACY_POLICY_VERSION)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows provider setup with onboarding mode when choosing another provider', async () => {
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))

    await waitFor(() => expect(screen.getByTestId('provider-settings')).toBeInTheDocument())
    expect(screen.getByTestId('provider-settings')).toHaveAttribute('data-onboarding', 'true')
    expect(screen.getByRole('heading', { name: 'onboarding.provider_setup.title' })).toBeInTheDocument()
  })

  it('moves from provider setup to model selection and completes the flow', async () => {
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'onboarding.provider_setup.next' }))

    expect(screen.getByRole('heading', { name: 'onboarding.select_model.title' })).toBeInTheDocument()
    expect(screen.getByTestId('model-settings')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.select_model\.start/ }))

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('completed')
    )
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe(LATEST_PRIVACY_POLICY_VERSION)
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.data_collection.enabled')).toBe(true)
  })

  it('does not allow CherryAI to satisfy the provider setup requirements', async () => {
    enabledProvidersMock.splice(0, enabledProvidersMock.length, { id: 'cherryai', isEnabled: true })
    enabledModelsMock.splice(0, enabledModelsMock.length, {
      id: 'cherryai::qwen',
      providerId: 'cherryai',
      isEnabled: true
    })
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))

    const nextButton = await screen.findByRole('button', { name: 'onboarding.provider_setup.next' })
    expect(nextButton).toHaveAttribute('aria-disabled', 'true')
    nextButton.focus()
    expect(nextButton).toHaveFocus()
    fireEvent.click(nextButton)
    expect(screen.getByRole('heading', { name: 'onboarding.provider_setup.title' })).toBeInTheDocument()
    expect(nextButton.parentElement).toHaveAttribute('data-title', 'onboarding.provider_setup.missing_provider')
  })

  it('explains when an enabled provider has no enabled model', async () => {
    enabledModelsMock.splice(0)
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))

    const nextButton = await screen.findByRole('button', { name: 'onboarding.provider_setup.next' })
    expect(nextButton).toHaveAttribute('aria-disabled', 'true')
    expect(nextButton.parentElement).toHaveAttribute('data-title', 'onboarding.provider_setup.missing_model')
  })

  it('keeps the start action disabled until all three models are selected', async () => {
    selectedModelsMock.translateModel = undefined
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'onboarding.provider_setup.next' }))

    expect(screen.getByRole('button', { name: /onboarding\.select_model\.start/ })).toBeDisabled()
  })

  it('excludes CherryAI models, hides painting, and rejects built-in selections', async () => {
    selectedModelsMock.defaultModel = { id: 'cherryai::qwen', providerId: CHERRYAI_PROVIDER_ID }
    selectedModelsMock.quickModel = { id: 'cherryai::qwen', providerId: CHERRYAI_PROVIDER_ID }
    selectedModelsMock.translateModel = { id: 'cherryai::qwen', providerId: CHERRYAI_PROVIDER_ID }
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'onboarding.provider_setup.next' }))

    const modelSettingsProps = modelSettingsPropsMock.mock.lastCall?.[0]
    expect(modelSettingsProps?.autoFillEmptyModels).toBe(true)
    expect(modelSettingsProps?.onDefaultModelSelected).toBeTypeOf('function')
    expect(modelSettingsProps?.showPaintingModel).toBe(false)
    expect(modelSettingsProps?.modelFilter?.({ providerId: CHERRYAI_PROVIDER_ID })).toBe(false)
    expect(modelSettingsProps?.modelFilter?.({ providerId: 'openai' })).toBe(true)
    expect(screen.getByRole('button', { name: /onboarding\.select_model\.start/ })).toBeDisabled()
  })

  it('replaces the sole seeded assistant and agent models after selecting the default model', async () => {
    dataApiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/assistants') {
        return {
          items: [{ id: 'assistant-1', modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID }],
          total: 1
        }
      }
      if (path === '/agents') {
        return {
          items: [{ id: 'agent-1', model: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID }],
          total: 1
        }
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    dataApiMocks.patch.mockResolvedValue(undefined)
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'onboarding.provider_setup.next' }))

    const onDefaultModelSelected = modelSettingsPropsMock.mock.lastCall?.[0]?.onDefaultModelSelected
    await act(async () => {
      await onDefaultModelSelected?.({ id: 'openai::gpt-4o', providerId: 'openai' })
    })

    expect(dataApiMocks.get).toHaveBeenCalledWith('/assistants', { query: { limit: 2 } })
    expect(dataApiMocks.get).toHaveBeenCalledWith('/agents', { query: { limit: 2 } })
    expect(dataApiMocks.patch).toHaveBeenCalledWith('/assistants/assistant-1', {
      body: { modelId: 'openai::gpt-4o' }
    })
    expect(dataApiMocks.patch).toHaveBeenCalledWith('/agents/agent-1', {
      body: { model: 'openai::gpt-4o' }
    })
  })

  it('preserves assistant and agent models unless both replacement conditions match', async () => {
    dataApiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/assistants') {
        return {
          items: [
            { id: 'assistant-1', modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID },
            { id: 'assistant-2', modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID }
          ],
          total: 2
        }
      }
      if (path === '/agents') {
        return {
          items: [{ id: 'agent-1', model: 'openai::existing' }],
          total: 1
        }
      }
      throw new Error(`Unexpected path: ${path}`)
    })
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'onboarding.provider_setup.next' }))

    const onDefaultModelSelected = modelSettingsPropsMock.mock.lastCall?.[0]?.onDefaultModelSelected
    await act(async () => {
      await onDefaultModelSelected?.({ id: 'openai::gpt-4o', providerId: 'openai' })
    })

    expect(dataApiMocks.patch).not.toHaveBeenCalled()
  })

  it('records a skipped status when the user skips onboarding', async () => {
    render(<OnboardingPage />)

    const skipButton = screen.getByRole('button', { name: 'onboarding.skip' })
    expect(skipButton).toHaveClass('nodrag')

    fireEvent.click(skipButton)

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('skipped')
    )
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe(LATEST_PRIVACY_POLICY_VERSION)
  })

  it('shows the privacy control only on the welcome step', async () => {
    render(<OnboardingPage />)

    expect(screen.getByRole('checkbox', { name: 'onboarding.privacy.accept_policy' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))
    await screen.findByTestId('provider-settings')
    expect(screen.queryByRole('checkbox', { name: 'onboarding.privacy.accept_policy' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.provider_setup.next' }))
    await screen.findByTestId('model-settings')
    expect(screen.queryByRole('checkbox', { name: 'onboarding.privacy.accept_policy' })).not.toBeInTheDocument()
  })

  it('checks privacy acceptance by default for a new user without a stored policy version', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', '')
    render(<OnboardingPage />)

    expect(screen.getByRole('checkbox', { name: 'onboarding.privacy.accept_policy' })).toBeChecked()
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe('')
  })

  it('requires privacy acceptance before opening provider setup and resumes after acceptance', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', '')
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'onboarding.privacy.accept_policy' }))
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.welcome.other_provider' }))
    expect(screen.getByTestId('privacy-policy-dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('provider-settings')).not.toBeInTheDocument()
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'decline-policy' }))
    await waitFor(() => expect(screen.queryByTestId('privacy-policy-dialog')).not.toBeInTheDocument())
    expect(screen.queryByTestId('provider-settings')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'onboarding.privacy.accept_policy' })).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.welcome.other_provider' }))
    fireEvent.click(screen.getByRole('button', { name: 'accept-policy' }))

    await waitFor(() => expect(screen.getByTestId('provider-settings')).toBeInTheDocument())
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe(LATEST_PRIVACY_POLICY_VERSION)
  })

  it('requires privacy acceptance before starting CherryIN login', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', '')
    oauthWithCherryInMock.mockImplementation(async (setKey: (keys: string) => Promise<void>) => {
      await setKey('sk-one')
      return 'sk-one'
    })
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'onboarding.privacy.accept_policy' }))
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.welcome.login_cherryin' }))

    expect(screen.getByTestId('privacy-policy-dialog')).toBeInTheDocument()
    expect(oauthWithCherryInMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'accept-policy' }))

    await waitFor(() => expect(oauthWithCherryInMock).toHaveBeenCalledTimes(1))
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe(LATEST_PRIVACY_POLICY_VERSION)
  })

  it('requires privacy acceptance before skipping onboarding', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', '')
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'onboarding.privacy.accept_policy' }))
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.skip' }))

    expect(screen.getByTestId('privacy-policy-dialog')).toBeInTheDocument()
    expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('pending')

    fireEvent.click(screen.getByRole('button', { name: 'decline-policy' }))
    await waitFor(() => expect(screen.queryByTestId('privacy-policy-dialog')).not.toBeInTheDocument())
    expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('pending')

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'accept-policy' }))

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('skipped')
    )
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe(LATEST_PRIVACY_POLICY_VERSION)
  })

  it('persists a checked agreement only when leaving the welcome page', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', '')
    render(<OnboardingPage />)

    const agreement = screen.getByRole('checkbox', { name: 'onboarding.privacy.accept_policy' })

    expect(agreement).toBeChecked()
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.welcome.other_provider' }))

    await waitFor(() => expect(screen.getByTestId('provider-settings')).toBeInTheDocument())
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe(LATEST_PRIVACY_POLICY_VERSION)
  })

  it('opens the full policy and updates the required agreement choice before closing', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', '')
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.privacy.policy' }))
    expect(screen.getByTestId('privacy-policy-dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'decline-policy' }))

    await waitFor(() => expect(screen.queryByTestId('privacy-policy-dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'onboarding.privacy.accept_policy' })).not.toBeChecked()
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.privacy.policy' }))
    fireEvent.click(screen.getByRole('button', { name: 'accept-policy' }))

    expect(screen.getByRole('checkbox', { name: 'onboarding.privacy.accept_policy' })).toBeChecked()
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe('')
  })

  it('stays on the welcome page when saving privacy acceptance fails', async () => {
    const updatePreferences = vi.fn().mockRejectedValue(new Error('write failed'))
    mockUseMultiplePreferences.mockReturnValueOnce([
      {
        providerSetupStatus: 'pending',
        dataCollectionEnabled: true,
        policyVersion: ''
      },
      updatePreferences
    ])
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.welcome.other_provider' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('onboarding.privacy.update_failed'))
    expect(updatePreferences).toHaveBeenCalledWith({ policyVersion: LATEST_PRIVACY_POLICY_VERSION })
    expect(screen.queryByTestId('provider-settings')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'onboarding.welcome.other_provider' })).toBeInTheDocument()
  })

  it('keeps anonymous data collection independent from required privacy acceptance', async () => {
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.policy_version', '')
    MockUsePreferenceUtils.setPreferenceValue('app.privacy.data_collection.enabled', false)
    render(<OnboardingPage />)

    const agreement = screen.getByRole('checkbox', { name: 'onboarding.privacy.accept_policy' })
    expect(agreement).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.skip' }))

    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.onboarding.provider_setup.status')).toBe('skipped')
    )
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.policy_version')).toBe(
        LATEST_PRIVACY_POLICY_VERSION
      )
    )
    expect(MockUsePreferenceUtils.getPreferenceValue('app.privacy.data_collection.enabled')).toBe(false)
  })

  it('shows an error when completing onboarding fails', async () => {
    const updatePreferences = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('write failed'))
    mockUseMultiplePreferences.mockReturnValueOnce([
      {
        providerSetupStatus: 'pending',
        dataCollectionEnabled: true,
        policyVersion: LATEST_PRIVACY_POLICY_VERSION
      },
      updatePreferences
    ])
    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.skip' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('onboarding.toast.complete_failed'))
    expect(updatePreferences).toHaveBeenNthCalledWith(2, {
      providerSetupStatus: 'skipped',
      dataCollectionEnabled: true,
      policyVersion: LATEST_PRIVACY_POLICY_VERSION
    })
    expect(screen.getByRole('button', { name: 'onboarding.skip' })).toBeEnabled()
  })

  it('renders window controls beside the skip action for frameless Windows', () => {
    const { container } = render(<OnboardingPage />)

    expect(screen.getByRole('button', { name: 'onboarding.skip' })).toBeInTheDocument()
    expect(screen.getByTestId('window-controls')).toBeInTheDocument()
    expect(container.querySelector('.drag')).toHaveClass('h-[var(--app-top-chrome-height)]')
    expect(responsiveStyles).toMatch(/--app-top-chrome-height:\s*44px/)
    expect(responsiveStyles).toMatch(/--navbar-height:\s*var\(--app-top-chrome-height\)/)
  })

  it('changes the interface language and saves the preference from the top chrome', async () => {
    render(<OnboardingPage />)

    const languageTrigger = screen.getByRole('button', { name: 'common.language' })
    const languageSelector = languageTrigger.closest('[data-onboarding-language-select]')
    const skipButton = screen.getByRole('button', { name: 'onboarding.skip' })

    expect(languageTrigger).toHaveClass('nodrag')
    expect(languageSelector?.nextElementSibling).toBe(skipButton)

    fireEvent.click(screen.getByRole('button', { name: '中文' }))

    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('zh-CN')
    await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('app.language')).toBe('zh-CN'))
  })

  it('uses an elevated welcome layout with clear text hierarchy and intentional spacing', () => {
    render(<OnboardingPage />)

    const logo = screen.getByRole('img', { name: 'Cherry Studio' })
    const welcomeContent = logo.parentElement
    const primaryAction = screen.getByRole('button', { name: 'onboarding.welcome.login_cherryin' })
    const secondaryAction = screen.getByRole('button', { name: 'onboarding.welcome.other_provider' })

    expect(welcomeContent?.parentElement).toHaveClass('pb-20')
    expect(logo.nextElementSibling).toHaveClass('mt-5', 'flex', 'flex-col', 'gap-2')
    expect(screen.getByText('onboarding.welcome.subtitle')).toHaveClass('text-foreground-secondary')
    expect(primaryAction.parentElement).toHaveClass('mt-8')
    expect(primaryAction).toHaveClass('rounded-xl')
    expect(secondaryAction).toHaveClass('rounded-xl')
    expect(primaryAction.querySelector('svg')).toHaveClass('lucide-log-in')
    expect(screen.queryByText('onboarding.welcome.or_continue_with')).not.toBeInTheDocument()
    expect(screen.getByText('onboarding.welcome.setup_hint')).toHaveClass('mt-4')
  })

  it('hides the login icon while loading and restores the action after ten seconds', async () => {
    vi.useFakeTimers()
    oauthWithCherryInMock.mockImplementation(() => new Promise<string>(() => {}))
    render(<OnboardingPage />)

    const loginButton = screen.getByRole('button', { name: 'onboarding.welcome.login_cherryin' })
    fireEvent.click(loginButton)

    expect(loginButton).toBeDisabled()
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(loginButton.querySelector('.lucide-log-in')).not.toBeInTheDocument()

    await act(() => vi.advanceTimersByTime(9_999))
    expect(loginButton).toBeDisabled()

    await act(() => vi.advanceTimersByTime(1))
    expect(loginButton).toBeEnabled()
    expect(loginButton.querySelector('.lucide-log-in')).toBeInTheDocument()
  })

  it('syncs CherryIN models before moving a fresh install to model selection', async () => {
    enabledProvidersMock.splice(0, enabledProvidersMock.length, { id: 'cherryai', isEnabled: true })
    enabledModelsMock.splice(0, enabledModelsMock.length, {
      id: 'cherryai::qwen',
      providerId: 'cherryai',
      isEnabled: true
    })
    selectedModelsMock.defaultModel = { id: 'cherryai::qwen', providerId: CHERRYAI_PROVIDER_ID }
    selectedModelsMock.quickModel = { id: 'cherryai::qwen', providerId: CHERRYAI_PROVIDER_ID }
    selectedModelsMock.translateModel = { id: 'cherryai::qwen', providerId: CHERRYAI_PROVIDER_ID }
    oauthWithCherryInMock.mockImplementation(async (setKey: (keys: string) => Promise<void>) => {
      await setKey('sk-one, sk-two')
      return 'sk-one, sk-two'
    })

    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.login_cherryin/ }))

    await waitFor(() => expect(screen.getByTestId('model-settings')).toBeInTheDocument())
    expect(addApiKeyMock).toHaveBeenCalledWith('sk-one', 'OAuth')
    expect(addApiKeyMock).toHaveBeenCalledWith('sk-two', 'OAuth')
    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true })
    expect(syncProviderModelsMock).toHaveBeenCalledTimes(1)
    expect(toastSuccessMock).toHaveBeenCalledWith('onboarding.toast.connected')
  })

  it('returns to provider setup when CherryIN sync finds no enabled model', async () => {
    syncProviderModelsMock.mockResolvedValue([])
    oauthWithCherryInMock.mockImplementation(async (setKey: (keys: string) => Promise<void>) => {
      await setKey('sk-one')
      return 'sk-one'
    })

    render(<OnboardingPage />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.login_cherryin/ }))

    await waitFor(() => expect(syncProviderModelsMock).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('provider-settings')).toBeInTheDocument()
    expect(screen.queryByTestId('model-settings')).not.toBeInTheDocument()
    expect(toastErrorMock).toHaveBeenCalledWith('onboarding.provider_setup.missing_model')
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })
})
