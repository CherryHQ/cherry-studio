import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

describe('SelectionActionUserModal', () => {
  it('lets assistant names use the available select row width', () => {
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
    expect(assistantName).toHaveClass('min-w-0', 'flex-1', 'truncate')
    expect(assistantName).toHaveAttribute('title', testData.longAssistantName)
    expect(assistantName).not.toHaveClass('max-w-[calc(100%-60px)]')
    expect(assistantName.parentElement).toHaveClass('min-w-0', 'w-full')
    expect(screen.getByTestId('model-avatar')).toHaveClass('shrink-0')
  })

  it('clips long assistant options to the select width', () => {
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

    expect(screen.getByTestId('select-trigger')).toHaveClass('min-w-0', 'overflow-hidden')
    expect(screen.getByTestId('select-value')).toHaveClass('min-w-0', 'flex-1', 'overflow-hidden')
    expect(screen.getByTestId('select-content')).toHaveClass(
      'w-(--radix-select-trigger-width)',
      'max-w-(--radix-select-trigger-width)'
    )
    expect(screen.getByTestId('select-item')).toHaveClass('overflow-hidden')
    expect(screen.getByText(testData.longAssistantName).parentElement).toHaveClass('max-w-full', 'overflow-hidden')
  })
})
