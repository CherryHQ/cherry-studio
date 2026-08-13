import type * as CherryStudioUi from '@cherrystudio/ui'
import { Form } from '@cherrystudio/ui'
import type * as EditDialogSharedModule from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceCreateWizardFormValues } from '../../types'
import { BasicInfoStep } from '../BasicInfoStep'

const { mockUseModelById } = vi.hoisted(() => ({
  mockUseModelById: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: () => null
}))

vi.mock('@renderer/components/PermissionModeSelect', () => ({
  PermissionModeSelect: ({
    value,
    onValueChange
  }: {
    value: AgentPermissionMode
    onValueChange: (value: AgentPermissionMode) => void
  }) => (
    <select
      aria-label="library.config.agent.field.permission_mode.label"
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value as AgentPermissionMode)}>
      <option value="bypassPermissions">bypassPermissions</option>
      <option value="plan">plan</option>
    </select>
  )
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: mockUseModelById
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderDisplayName: () => ''
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/components/EditDialogShared', async () => {
  const actual = await vi.importActual<typeof EditDialogSharedModule>(
    '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
  )

  return {
    ...actual,
    AvatarField: () => <div data-testid="avatar-field" />
  }
})

function Harness({
  modelId = null,
  showPermissionMode = true
}: {
  modelId?: UniqueModelId | null
  showPermissionMode?: boolean
}) {
  const form = useForm<ResourceCreateWizardFormValues>({
    defaultValues: {
      avatar: '💬',
      name: '',
      description: '',
      modelId,
      prompt: '',
      knowledgeBaseIds: [],
      skillIds: [],
      permissionMode: 'bypassPermissions'
    }
  })

  return (
    <Form {...form}>
      <BasicInfoStep form={form} portalContainer={null} fallbackAvatar="💬" showPermissionMode={showPermissionMode} />
      <output data-testid="permission-mode">{form.watch('permissionMode')}</output>
    </Form>
  )
}

afterEach(cleanup)

beforeEach(() => {
  mockUseModelById.mockReset()
  mockUseModelById.mockReturnValue({ model: undefined })
})

describe('BasicInfoStep', () => {
  it('focuses the name field by default', async () => {
    render(<Harness />)

    await waitFor(() =>
      expect(screen.getByPlaceholderText('library.config.dialogs.create.name_placeholder')).toHaveFocus()
    )
  })

  it('clears the missing-model warning when a prefilled model resolves asynchronously', async () => {
    const modelId = 'openai::gpt-4o' as UniqueModelId
    const view = render(<Harness modelId={modelId} />)

    expect(screen.getByText('library.config.basic.model_not_found')).toBeInTheDocument()

    mockUseModelById.mockReturnValue({
      model: { id: modelId, name: 'GPT-4o', providerId: 'openai' } as Model
    })
    view.rerender(<Harness modelId={modelId} />)

    await waitFor(() => expect(screen.queryByText('library.config.basic.model_not_found')).not.toBeInTheDocument())
  })

  it('shows and updates the permission mode for an agent', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const modelLabel = screen.getByText('common.model')
    const permissionLabel = screen.getByText('library.config.agent.field.permission_mode.label')
    const descriptionLabel = screen.getByText('common.description')

    expect(modelLabel.compareDocumentPosition(permissionLabel)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(permissionLabel.compareDocumentPosition(descriptionLabel)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByTestId('permission-mode')).toHaveTextContent('bypassPermissions')
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'library.config.agent.field.permission_mode.label' }),
      'plan'
    )

    expect(screen.getByTestId('permission-mode')).toHaveTextContent('plan')
  })

  it('does not show the agent permission mode for an assistant', () => {
    render(<Harness showPermissionMode={false} />)

    expect(
      screen.queryByRole('combobox', { name: 'library.config.agent.field.permission_mode.label' })
    ).not.toBeInTheDocument()
  })
})
