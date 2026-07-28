import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUI from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import SelectionActionUserModal from '../SelectionActionUserModal'

const testData = vi.hoisted(() => {
  const longAssistantName =
    'AssistantWithAnExtremelyLongUnbrokenNameThatShouldNeverForceTheSelectionAssistantModalToGrowHorizontally'

  return {
    longAssistantName,
    assistants: [
      {
        id: 'assistant-chatgpt-import',
        name: longAssistantName
      }
    ]
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: () => ({
    assistants: testData.assistants
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({
    defaultModel: undefined
  })
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: ({ className }: { className?: string }) => <span data-testid="model-avatar" className={className} />
}))

vi.mock('@renderer/components/CopyButton', () => ({
  default: () => <button type="button" aria-label="copy-placeholder" />
}))

vi.mock('@cherrystudio/ui', async () => {
  return vi.importActual<typeof CherryStudioUI>('@cherrystudio/ui')
})

beforeAll(() => {
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  HTMLElement.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
})

describe('SelectionActionUserModal', () => {
  it('left-aligns assistant names while using the available select row width', () => {
    render(
      <SelectionActionUserModal
        isModalOpen={true}
        editingAction={{
          id: 'user-action',
          name: 'Custom action',
          enabled: true,
          isBuiltIn: false,
          assistantId: 'assistant-chatgpt-import'
        }}
        onOk={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const assistantName = screen.getByText(testData.longAssistantName)
    expect(assistantName).toHaveClass('min-w-0', 'flex-1', 'truncate', 'text-left')
    expect(assistantName).toHaveAttribute('title', testData.longAssistantName)
    expect(assistantName).not.toHaveClass('max-w-[calc(100%-60px)]')
    expect(assistantName.parentElement).toHaveClass('min-w-0', 'w-full')
    expect(screen.getByTestId('model-avatar')).toHaveClass('shrink-0')
  })

  it('clips long assistant options to the select width', async () => {
    render(
      <SelectionActionUserModal
        isModalOpen={true}
        editingAction={{
          id: 'user-action',
          name: 'Custom action',
          enabled: true,
          isBuiltIn: false,
          assistantId: 'assistant-chatgpt-import'
        }}
        onOk={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
    expect(trigger).toHaveClass(
      'min-w-0',
      'overflow-hidden',
      '*:data-[slot=select-value]:min-w-0',
      '*:data-[slot=select-value]:flex-1',
      '*:data-[slot=select-value]:overflow-hidden'
    )
    expect(trigger.querySelector('[data-slot="select-value"]')).toBeInTheDocument()

    fireEvent.pointerDown(trigger)
    fireEvent.click(trigger)

    const content = await screen.findByRole('listbox')
    expect(content).toHaveClass('w-(--radix-select-trigger-width)', 'max-w-(--radix-select-trigger-width)')
    const option = within(content).getByText(testData.longAssistantName).closest('[role="option"]')
    expect(option).toBeInstanceOf(HTMLElement)
    const optionElement = option as HTMLElement
    expect(optionElement).toHaveClass('overflow-hidden')
    expect(within(optionElement).getByText(testData.longAssistantName).parentElement).toHaveClass(
      'max-w-full',
      'overflow-hidden'
    )
  })
})
