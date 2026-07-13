import type * as CherryStudioUi from '@cherrystudio/ui'
import { Form } from '@cherrystudio/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'

import type { ResourceCreateWizardFormValues } from '../../types'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@renderer/hooks/agent/useAgentModelFilter', () => ({ useAgentModelFilter: () => () => true }))
vi.mock('@renderer/components/resourceCatalog/dialogs/components/EditDialogShared', () => ({
  AvatarField: () => null,
  CompactModelField: () => null,
  TextInputField: () => null
}))

const { BasicInfoStep } = await import('../BasicInfoStep')

function StellaForm() {
  const form = useForm<ResourceCreateWizardFormValues>({
    defaultValues: {
      avatar: '🤖',
      name: '',
      description: '',
      agentType: 'stella',
      modelId: null,
      stellaEndpoint: 'https://stella.example',
      stellaPat: 'secret',
      stellaRemoteAgentId: '',
      prompt: '',
      knowledgeBaseIds: [],
      skillIds: []
    }
  })
  return (
    <Form {...form}>
      <form>
        <BasicInfoStep form={form} portalContainer={null} fallbackAvatar="🤖" runtimeSelectable />
      </form>
    </Form>
  )
}

describe('BasicInfoStep Stella connection', () => {
  it('renders the remote-agent field inside the form contract after listing agents', async () => {
    mocks.request
      .mockResolvedValueOnce({ endpoint: 'https://stella.example', configured: true })
      .mockResolvedValueOnce([{ id: 'remote-1', name: 'Remote Agent' }])

    render(<StellaForm />)
    fireEvent.click(screen.getByRole('button', { name: 'library.config.agent.field.stella.connect' }))

    expect(await screen.findByText('library.config.agent.field.stella.remote_agent')).toBeInTheDocument()
  })
})
