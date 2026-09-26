import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

import SelectionActionUserModal from '../SelectionActionUserModal'

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => null
}))

vi.mock('@renderer/components/CopyButton', () => ({
  default: () => null
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: () => ({ assistants: [] })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ defaultModel: undefined })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('SelectionActionUserModal', () => {
  it('keeps the footer accessible when editing a long prompt', () => {
    const longPrompt = 'Keep the prompt inside the dialog.\n'.repeat(200)
    const onOk = vi.fn()
    const editingAction: SelectionActionItem = {
      id: 'user-long-prompt',
      name: 'Long prompt',
      enabled: true,
      isBuiltIn: false,
      prompt: longPrompt
    }

    render(<SelectionActionUserModal isModalOpen editingAction={editingAction} onOk={onOk} onCancel={vi.fn()} />)

    const prompt = screen.getByPlaceholderText('selection.settings.user_modal.prompt.placeholder')
    const dialogContent = screen.getByTestId('dialog-content')
    const scrollableBody = dialogContent.children[1]

    expect(prompt).toHaveValue(longPrompt)
    // These layout utilities are the viewport/scroll contract that prevents issue #19358.
    expect(dialogContent).toHaveClass(
      'max-h-[calc(100vh-2rem)]',
      'grid-rows-[auto_minmax(0,1fr)_auto]',
      'overflow-hidden'
    )
    expect(scrollableBody).toHaveClass('min-h-0', 'overflow-y-auto')
    expect(prompt).toHaveClass('max-h-40', 'overflow-y-auto', 'resize-none')
    const confirmButton = screen.getByRole('button', { name: 'common.confirm' })
    expect(confirmButton).toBeVisible()

    fireEvent.click(confirmButton)

    expect(onOk).toHaveBeenCalledWith(editingAction)
  })
})
