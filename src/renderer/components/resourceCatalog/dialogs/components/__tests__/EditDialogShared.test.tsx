import type * as CherryStudioUi from '@cherrystudio/ui'
import { Form } from '@cherrystudio/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLoggerWarn, mockUseQuery, mockIpcRequest, mockToastSuccess } = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
  mockUseQuery: vi.fn(),
  mockIpcRequest: vi.fn(),
  mockToastSuccess: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal<typeof CherryStudioUi>())

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

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mockIpcRequest }
}))

import { KnowledgeStep } from '../../create/steps/KnowledgeStep'
import type { ResourceCreateWizardFormValues } from '../../create/types'
import { isDetachedInteractionOrigin, PromptVariablesPopover } from '../EditDialogShared'

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = () => {}
})

describe('EditDialogShared', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    mockUseQuery.mockReturnValue({ data: { items: [] }, isLoading: false })
    mockIpcRequest.mockReset()
    mockToastSuccess.mockReset()
    writeText.mockResolvedValue(undefined)
    mockLoggerWarn.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
  })

  it('opens the prompt variables popover from the keyboard and copies a variable', async () => {
    const portalContainer = document.createElement('div')
    document.body.append(portalContainer)

    try {
      render(<PromptVariablesPopover portalContainer={portalContainer} />)

      expect(screen.queryByRole('button', { name: 'Copy {{date}}' })).not.toBeInTheDocument()

      screen.getByRole('button', { name: 'System variables' }).focus()
      await userEvent.keyboard('{Enter}')

      const copyButton = await screen.findByRole('button', { name: 'Copy {{date}}' })
      expect(portalContainer.querySelector('[data-slot="popover-content"]')).toContainElement(copyButton)
      expect(copyButton).toHaveFocus()

      await userEvent.click(copyButton)

      expect(writeText).toHaveBeenCalledWith('{{date}}')
      await vi.waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Copied'))
      expect(mockLoggerWarn).not.toHaveBeenCalled()
    } finally {
      portalContainer.remove()
    }
  })

  it('opens the knowledge page in a standalone window without closing the knowledge step', () => {
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

    expect(screen.queryByRole('button', { name: 'Open Knowledge to create one' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add knowledge base' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Knowledge to create one' }))

    expect(mockIpcRequest).toHaveBeenCalledTimes(1)
    expect(mockIpcRequest).toHaveBeenCalledWith(
      'tab.detach',
      expect.objectContaining({ url: '/app/knowledge', type: 'route' })
    )
    expect(screen.getByRole('button', { name: 'Open Knowledge to create one' })).toBeInTheDocument()
  })

  it('opts the knowledge list into revalidation when the source window regains focus', () => {
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

    expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-bases', {
      query: { limit: 100 },
      swrOptions: { revalidateOnFocus: true }
    })
  })

  it('closes and disables the knowledge picker when submission starts', async () => {
    mockUseQuery.mockReturnValue({
      data: { items: [{ id: 'knowledge-1', name: 'Knowledge one', itemCount: 1 }] },
      isLoading: false
    })

    function Harness() {
      const [isSubmitting, setIsSubmitting] = useState(false)
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
          <KnowledgeStep form={form} isSubmitting={isSubmitting} portalContainer={null} />
          <button type="button" onClick={() => setIsSubmitting(true)}>
            Start submission
          </button>
        </Form>
      )
    }

    render(<Harness />)

    await userEvent.click(screen.getByRole('button', { name: 'Add knowledge base' }))
    expect(screen.getByText('Knowledge one')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Start submission' }))

    expect(screen.queryByText('Knowledge one')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add knowledge base' })).toBeDisabled()
  })

  describe('isDetachedInteractionOrigin', () => {
    const eventFor = (target: EventTarget | null) =>
      ({ detail: { originalEvent: { target } as unknown as Event } }) as { detail: { originalEvent: Event } }

    it('ignores interactions whose origin was detached mid-edit (auto-save re-render)', () => {
      const detached = document.createElement('div')
      expect(detached.isConnected).toBe(false)
      expect(isDetachedInteractionOrigin(eventFor(detached))).toBe(true)
    })

    it('keeps intentional dismissal when the origin is still connected', () => {
      const connected = document.createElement('div')
      document.body.append(connected)
      try {
        expect(isDetachedInteractionOrigin(eventFor(connected))).toBe(false)
      } finally {
        connected.remove()
      }
    })

    it('does not guard when there is no interaction origin', () => {
      expect(isDetachedInteractionOrigin(eventFor(null))).toBe(false)
    })
  })
})
