import type * as CherryStudioUi from '@cherrystudio/ui'
import { Form } from '@cherrystudio/ui'
import type * as EditDialogSharedModule from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResourceCreateWizardFormValues } from '../../types'
import { BasicInfoStep } from '../BasicInfoStep'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/components/resourceCatalog/dialogs/components/EditDialogShared', async () => {
  const actual = await vi.importActual<typeof EditDialogSharedModule>(
    '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'
  )

  return {
    ...actual,
    AvatarField: () => <div data-testid="avatar-field" />,
    CompactModelField: () => <div data-testid="model-field" />
  }
})

function Harness() {
  const form = useForm<ResourceCreateWizardFormValues>({
    defaultValues: {
      avatar: '💬',
      name: '',
      description: '',
      modelId: null,
      prompt: '',
      knowledgeBaseIds: [],
      skillIds: []
    }
  })

  return (
    <Form {...form}>
      <BasicInfoStep form={form} portalContainer={null} fallbackAvatar="💬" />
    </Form>
  )
}

afterEach(cleanup)

describe('BasicInfoStep', () => {
  it('focuses the name field by default', async () => {
    render(<Harness />)

    await waitFor(() =>
      expect(screen.getByPlaceholderText('library.config.dialogs.create.name_placeholder')).toHaveFocus()
    )
  })
})
