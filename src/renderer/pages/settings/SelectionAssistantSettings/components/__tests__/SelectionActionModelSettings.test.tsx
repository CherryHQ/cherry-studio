import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'

import SelectionActionModelSettings from '../SelectionActionModelSettings'

const modelState = vi.hoisted(() => ({
  defaultModel: {
    id: 'openai::gpt-4o',
    providerId: 'openai',
    apiModelId: 'gpt-4o',
    name: 'GPT-4o',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } satisfies Model,
  translateModel: {
    id: 'deepseek::deepseek-chat',
    providerId: 'deepseek',
    apiModelId: 'deepseek-chat',
    name: 'DeepSeek Chat',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } satisfies Model
}))
const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => null
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => modelState
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('SelectionActionModelSettings', () => {
  beforeEach(() => {
    navigateMock.mockClear()
  })

  it('shows the effective default and translation models', () => {
    render(<SelectionActionModelSettings />)

    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
    expect(screen.getByText('DeepSeek Chat')).toBeInTheDocument()
  })

  it.each([
    ['settings.models.default_assistant_model', 'default'],
    ['settings.models.translate_model', 'translate']
  ] as const)('opens the focused model setting from %s', async (rowName, focus) => {
    const user = userEvent.setup()
    render(<SelectionActionModelSettings />)

    const row = screen.getByRole('group', { name: rowName })
    await user.click(within(row).getByRole('button', { name: 'navigate.model_settings' }))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/model', search: { focus } })
  })
})
