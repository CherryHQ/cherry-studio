import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import AddModelFormPanel from '../AddModelFormPanel'

const useProviderMock = vi.fn()
const createModelMock = vi.fn()

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: unknown[]) => useProviderMock(...args)
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: [] }),
  useModelMutations: () => ({ createModel: (...args: unknown[]) => createModelMock(...args) })
}))

describe('AddModelFormPanel web search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: {
        id: 'custom',
        presetProviderId: null,
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        serverTools: [],
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'openai-compatible' },
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'openai-compatible' }
        }
      }
    })
  })

  it('shows the endpoint error when web search cannot be enabled', async () => {
    const user = userEvent.setup()
    render(<AddModelFormPanel providerId="custom" prefill={null} onSuccess={vi.fn()} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'settings.moresetting.label' }))
    await user.click(screen.getByRole('button', { name: 'models.type.websearch' }))

    expect(toast.error).toHaveBeenCalledWith('settings.models.add.web_search.endpoint_required')
    expect(createModelMock).not.toHaveBeenCalled()
  })
})
