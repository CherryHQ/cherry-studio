import type { Model } from '@shared/data/types/model'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const explicitModel = {
  id: 'openai::gpt-4o-mini',
  providerId: 'openai',
  name: 'GPT-4o Mini',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
} satisfies Model

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: (id: string | null) => ({ model: id === explicitModel.id ? explicitModel : undefined })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] })
}))

vi.mock('@renderer/components/icons/ResetIcon', () => ({
  default: () => null
}))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingSubtitle: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, type = 'button', ...props }: ComponentProps<'button'>) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
  ColFlex: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Divider: () => <hr />,
  Flex: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  RowFlex: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Switch: ({
    onCheckedChange,
    ...props
  }: ComponentProps<'input'> & { onCheckedChange?: (checked: boolean) => void }) => (
    <input type="checkbox" {...props} onChange={(event) => onCheckedChange?.(event.currentTarget.checked)} />
  ),
  Textarea: { Input: (props: ComponentProps<'textarea'>) => <textarea {...props} /> }
}))

vi.mock('../DefaultModelSelector', () => ({
  DefaultModelSelector: ({
    noneOptionLabel,
    placeholder,
    model,
    onSelect
  }: {
    noneOptionLabel?: string
    placeholder: string
    model?: Model
    onSelect: (model: Model | undefined) => void
  }) =>
    noneOptionLabel ? (
      <>
        <span data-testid="model-selector-trigger-label">{model?.name ?? placeholder}</span>
        <button type="button" onClick={() => onSelect(undefined)}>
          {noneOptionLabel}
        </button>
      </>
    ) : null
}))

import { TopicNamingSettings } from '../TopicNamingSettings'

describe('TopicNamingSettings', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('topic.naming.model_id', explicitModel.id)
  })

  it('lets the user make topic naming follow the quick model', async () => {
    render(<TopicNamingSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'settings.models.topic_naming.follow_quick' }))

    await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('topic.naming.model_id')).toBeNull())
  })

  it('shows follow quick model in the selector when it is selected', () => {
    MockUsePreferenceUtils.setPreferenceValue('topic.naming.model_id', null)

    render(<TopicNamingSettings />)

    expect(screen.getByTestId('model-selector-trigger-label')).toHaveTextContent(
      'settings.models.topic_naming.follow_quick'
    )
  })
})
