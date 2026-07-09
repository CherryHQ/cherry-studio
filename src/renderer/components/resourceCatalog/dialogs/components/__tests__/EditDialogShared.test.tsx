import type * as CherryStudioUi from '@cherrystudio/ui'
import { Form } from '@cherrystudio/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNormalTooltipProps, mockLoggerWarn, mockUseQuery, mockOpenTab, mockToastSuccess } = vi.hoisted(() => ({
  mockNormalTooltipProps: [] as Array<{ sideOffset?: number }>,
  mockLoggerWarn: vi.fn(),
  mockUseQuery: vi.fn(),
  mockOpenTab: vi.fn(),
  mockToastSuccess: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: mockLoggerWarn
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const labels: Record<string, string> = {
        'library.config.knowledge.add': 'Add knowledge base',
        'library.config.knowledge.create_first': 'Open Knowledge to create one',
        'library.config.knowledge.doc_count': `${options?.count ?? 0} docs`,
        'library.config.knowledge.empty_desc': 'Link knowledge bases first.',
        'library.config.knowledge.empty_title': 'No knowledge bases linked',
        'library.config.knowledge.invalid_suffix': ' unavailable',
        'library.config.knowledge.linked': 'Linked knowledge bases',
        'library.config.knowledge.linked_hint': 'Controls knowledge bases.',
        'library.config.knowledge.no_more': 'No more knowledge bases',
        'library.config.knowledge.remove_aria': 'Remove knowledge base',
        'library.config.knowledge.search': 'Search knowledge bases',
        'library.config.prompt.copy_variable': `Copy ${options?.variable}`,
        'library.config.prompt.variables_description': 'Variables can be used in prompts.',
        'library.config.prompt.variables_example': `Example ${options?.variable}`,
        'library.config.prompt.variables_title': 'System variables',
        'library.config.prompt.vars.arch': 'Architecture',
        'library.config.prompt.vars.date': 'Date',
        'library.config.prompt.vars.datetime': 'Datetime',
        'library.config.prompt.vars.language': 'Language',
        'library.config.prompt.vars.model_name': 'Model name',
        'library.config.prompt.vars.os': 'OS',
        'library.config.prompt.vars.time': 'Time',
        'library.config.prompt.vars.username': 'Username',
        'message.copy.success': 'Copied'
      }
      return labels[key] ?? key
    }
  })
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    success: mockToastSuccess
  }
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useQuery: mockUseQuery
}))

vi.mock('@renderer/hooks/tab/useTabs', () => ({
  useTabs: () => ({
    openTab: mockOpenTab
  })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return {
    ...actual,
    NormalTooltip: ({
      children,
      content,
      sideOffset
    }: {
      children: ReactNode
      content: ReactNode
      sideOffset?: number
    }) => {
      mockNormalTooltipProps.push({ sideOffset })
      return (
        <div>
          {children}
          <div data-testid="tooltip-content">{content}</div>
        </div>
      )
    }
  }
})

import { KnowledgeStep } from '../../create/steps/KnowledgeStep'
import type { ResourceCreateWizardFormValues } from '../../create/types'
import { PromptVariablesPopover } from '../EditDialogShared'

describe('EditDialogShared', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    mockUseQuery.mockReturnValue({ data: { items: [] }, isLoading: false })
    mockOpenTab.mockReset()
    mockToastSuccess.mockReset()
    writeText.mockResolvedValue(undefined)
    mockLoggerWarn.mockReset()
    mockNormalTooltipProps.length = 0
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
  })

  it('copies a prompt variable from the tooltip content', async () => {
    render(<PromptVariablesPopover portalContainer={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy {{date}}' }))

    expect(writeText).toHaveBeenCalledWith('{{date}}')
    await vi.waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Copied'))
    expect(mockLoggerWarn).not.toHaveBeenCalled()
    expect(mockNormalTooltipProps.at(-1)).toMatchObject({ sideOffset: 0 })
  })

  it('opens the knowledge page from the empty knowledge step', () => {
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
          <KnowledgeStep form={form} portalContainer={null} />
        </Form>
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Open Knowledge to create one' }))

    expect(mockOpenTab).toHaveBeenCalledWith('/app/knowledge')
  })
})
