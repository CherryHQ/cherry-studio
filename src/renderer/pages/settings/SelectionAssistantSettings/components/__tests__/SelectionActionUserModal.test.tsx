import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { DEFAULT_ASSISTANT_ID } from '@shared/data/types/assistant'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import SelectionActionUserModal from '../SelectionActionUserModal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/utils/style', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => null
}))

vi.mock('@renderer/components/CopyButton', () => ({
  default: () => null
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: () => ({ assistants: [{ id: 'assistant-1', name: 'Assistant One' }] }),
  useDefaultAssistant: () => ({ assistant: { id: 'fallback-default', name: 'Default Assistant' } }),
  resolveDefaultAssistantOption: () => ({ id: 'fallback-default', name: 'Default Assistant' })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ defaultModel: undefined })
}))

vi.mock('lucide-react', () => ({
  CircleHelp: () => null,
  Dices: () => null,
  OctagonX: () => null
}))

vi.mock('lucide-react/dynamic', () => ({
  DynamicIcon: () => null,
  iconNames: []
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  Input: (props: any) => <input {...props} />,
  RadioGroup: ({ children }: any) => <div>{children}</div>,
  RadioGroupItem: ({ value }: any) => <input type="radio" value={value} readOnly />,
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  Textarea: { Input: (props: any) => <textarea {...props} /> },
  Tooltip: ({ children }: any) => <>{children}</>
}))

const buildAction = (overrides: Partial<SelectionActionItem>): SelectionActionItem => ({
  id: 'user-1',
  name: 'Summarize',
  enabled: true,
  isBuiltIn: false,
  icon: '',
  prompt: 'Summarize {{text}}',
  assistantId: '',
  ...overrides
})

describe('SelectionActionUserModal', () => {
  it('persists an empty assistantId when the default-assistant sentinel is selected', () => {
    const onOk = vi.fn()

    render(
      <SelectionActionUserModal
        isModalOpen
        editingAction={buildAction({ assistantId: DEFAULT_ASSISTANT_ID })}
        onOk={onOk}
        onCancel={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('common.confirm'))

    expect(onOk).toHaveBeenCalledWith(expect.objectContaining({ assistantId: '' }))
  })

  it('keeps a concrete assistantId untouched on save', () => {
    const onOk = vi.fn()

    render(
      <SelectionActionUserModal
        isModalOpen
        editingAction={buildAction({ assistantId: 'assistant-1' })}
        onOk={onOk}
        onCancel={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('common.confirm'))

    expect(onOk).toHaveBeenCalledWith(expect.objectContaining({ assistantId: 'assistant-1' }))
  })
})
