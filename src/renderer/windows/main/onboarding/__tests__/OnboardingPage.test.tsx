import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const addApiKeyMock = vi.fn()
const updateProviderMock = vi.fn()
const oauthWithCherryInMock = vi.fn()
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()
const selectedModelsMock: {
  defaultModel?: { id: string }
  quickModel?: { id: string }
  translateModel?: { id: string }
} = {}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({
    addApiKey: addApiKeyMock,
    updateProvider: updateProviderMock
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => selectedModelsMock
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
  )
}))

vi.mock('@renderer/pages/settings/ModelSettings/ModelSettings', () => ({
  default: () => <div data-testid="model-settings" />
}))

import OnboardingPage from '../OnboardingPage'

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    oauthWithCherryInMock.mockResolvedValue('sk-test')
    addApiKeyMock.mockResolvedValue(undefined)
    updateProviderMock.mockResolvedValue(undefined)
    selectedModelsMock.defaultModel = { id: 'default-model' }
    selectedModelsMock.quickModel = { id: 'quick-model' }
    selectedModelsMock.translateModel = { id: 'translate-model' }
  })

  it('shows provider setup with onboarding mode when choosing another provider', async () => {
    render(<OnboardingPage onComplete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))

    await waitFor(() => expect(screen.getByTestId('provider-settings')).toBeInTheDocument())
    expect(screen.getByTestId('provider-settings')).toHaveAttribute('data-onboarding', 'true')
    expect(screen.getByRole('heading', { name: 'onboarding.provider_setup.title' })).toBeInTheDocument()
  })

  it('moves from provider setup to model selection and completes the flow', async () => {
    const onComplete = vi.fn()
    render(<OnboardingPage onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'onboarding.provider_setup.next' }))

    expect(screen.getByRole('heading', { name: 'onboarding.select_model.title' })).toBeInTheDocument()
    expect(screen.getByTestId('model-settings')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.select_model\.start/ }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
  })

  it('keeps the start action disabled until all three models are selected', async () => {
    selectedModelsMock.translateModel = undefined
    render(<OnboardingPage onComplete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.other_provider/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'onboarding.provider_setup.next' }))

    expect(screen.getByRole('button', { name: /onboarding\.select_model\.start/ })).toBeDisabled()
  })

  it('completes directly when the user skips onboarding', async () => {
    const onComplete = vi.fn()
    render(<OnboardingPage onComplete={onComplete} />)

    const skipButton = screen.getByRole('button', { name: 'onboarding.skip' })
    expect(skipButton).toHaveClass('nodrag')

    fireEvent.click(skipButton)

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
  })

  it('renders window controls beside the skip action for frameless Windows', () => {
    render(<OnboardingPage onComplete={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'onboarding.skip' })).toBeInTheDocument()
    expect(screen.getByTestId('window-controls')).toBeInTheDocument()
  })

  it('stores CherryIN OAuth keys, enables the provider, and moves to model selection', async () => {
    oauthWithCherryInMock.mockImplementation(async (setKey: (keys: string) => Promise<void>) => {
      await setKey('sk-one, sk-two')
      return 'sk-one, sk-two'
    })

    render(<OnboardingPage onComplete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.login_cherryin/ }))

    await waitFor(() => expect(screen.getByTestId('model-settings')).toBeInTheDocument())
    expect(addApiKeyMock).toHaveBeenCalledWith('sk-one', 'OAuth')
    expect(addApiKeyMock).toHaveBeenCalledWith('sk-two', 'OAuth')
    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true })
    expect(toastSuccessMock).toHaveBeenCalledWith('onboarding.toast.connected')
  })
})
