import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, type ReactNode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AssistantCatalogPresetsModule from '@renderer/hooks/useAssistantCatalogPresets'
import { toast } from '@renderer/services/toast'

import { AssistantLibraryDialog } from '../AssistantLibraryDialog'

const createFromPresetMock = vi.fn()
const resolvePresetMock = vi.fn()
const refetchCreationDependenciesMock = vi.fn()

type VirtualizerOptionsMock = {
  count: number
  estimateSize: () => number
  getScrollElement: () => HTMLElement | null
  overscan?: number
}

const virtualizerMocks = vi.hoisted(() => ({
  measureElement: vi.fn(),
  useVirtualizer: vi.fn((options: VirtualizerOptionsMock) => ({
    getTotalSize: () => options.count * 70,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: index,
        size: 70,
        start: index * 70
      })),
    measureElement: virtualizerMocks.measureElement
  }))
}))

const assistantCatalogMocks = vi.hoisted(() => ({
  previewProps: undefined as any,
  presetsFixture: [
    { id: 'p1', name: 'Web Generator', description: 'Build a web page', group: ['Featured'] },
    { id: 'p2', name: 'Chain of Thought', prompt: 'thinking protocol', group: ['Featured'] }
  ],
  state: {
    isLoading: false,
    presets: [
      { id: 'p1', name: 'Web Generator', description: 'Build a web page', group: ['Featured'] },
      { id: 'p2', name: 'Chain of Thought', prompt: 'thinking protocol', group: ['Featured'] }
    ]
  } as { isLoading: boolean; presets: AssistantCatalogPresetsModule.AssistantCatalogPreset[] }
}))

const creationDependenciesMock = vi.hoisted(() => ({
  error: undefined as Error | undefined,
  isLoading: false
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } })
}))

vi.mock('@renderer/hooks/resourceCatalog', () => ({
  useAssistantPresetCreation: () => ({
    createFromPreset: createFromPresetMock,
    resolvePreset: resolvePresetMock,
    error: creationDependenciesMock.error,
    isLoading: creationDependenciesMock.isLoading,
    refetch: refetchCreationDependenciesMock
  })
}))

vi.mock('@renderer/hooks/useAssistantCatalogPresets', async (importOriginal) => {
  const actual = await importOriginal<typeof AssistantCatalogPresetsModule>()
  return {
    ...actual,
    useAssistantCatalogPresets: () => assistantCatalogMocks.state
  }
})

vi.mock('@renderer/components/resourceCatalog/dialogs/detail', () => ({
  AssistantPresetPreviewDialog: (props: any) => {
    assistantCatalogMocks.previewProps = props
    return props.open ? (
      <div data-testid="preset-preview" data-configuration-provider={props.configurationProviderId} />
    ) : null
  }
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualizerMocks.useVirtualizer
}))

vi.mock('@cherrystudio/ui', () => {
  let dialogOnOpenChange: ((open: boolean) => void) | undefined

  return {
    Dialog: ({
      children,
      onOpenChange,
      open
    }: {
      children?: ReactNode
      onOpenChange?: (open: boolean) => void
      open?: boolean
    }) => {
      dialogOnOpenChange = onOpenChange
      return open ? <>{children}</> : null
    },
    DialogContent: ({
      children,
      closeOnOverlayClick,
      ...props
    }: ComponentProps<'div'> & { closeOnOverlayClick?: boolean }) => {
      void closeOnOverlayClick
      return (
        <>
          <button type="button" data-testid="dialog-overlay" onClick={() => dialogOnOpenChange?.(false)} />
          <div {...props}>{children}</div>
        </>
      )
    },
    DialogHeader: ({ children }: { children?: ReactNode }) => <header>{children}</header>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    Alert: ({ action, description, message }: { action?: ReactNode; description?: ReactNode; message?: ReactNode }) => (
      <div role="alert">
        <div>{message}</div>
        <div>{description}</div>
        {action}
      </div>
    ),
    EmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
    Input: (props: ComponentProps<'input'>) => <input {...props} />,
    Skeleton: (props: ComponentProps<'div'>) => <div data-testid="skeleton" {...props} />,
    Button: ({
      children,
      loading,
      size,
      variant,
      ...props
    }: ComponentProps<'button'> & { loading?: boolean; size?: string; variant?: string }) => {
      void size
      void variant
      return (
        <button type="button" data-loading={loading ? 'true' : undefined} {...props}>
          {children}
        </button>
      )
    }
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  createFromPresetMock.mockResolvedValue({ status: 'created', assistant: { id: 'assistant-1' } })
  resolvePresetMock.mockReturnValue({ status: 'not-required' })
  refetchCreationDependenciesMock.mockResolvedValue(undefined)
  creationDependenciesMock.error = undefined
  creationDependenciesMock.isLoading = false
  virtualizerMocks.measureElement.mockClear()
  assistantCatalogMocks.previewProps = undefined
  assistantCatalogMocks.state.isLoading = false
  assistantCatalogMocks.state.presets = assistantCatalogMocks.presetsFixture
})

afterEach(cleanup)

function renderDialog(props: Partial<ComponentProps<typeof AssistantLibraryDialog>> = {}) {
  return render(<AssistantLibraryDialog open onOpenChange={vi.fn()} onAssistantAdded={vi.fn()} {...props} />)
}

function ControlledAssistantLibraryDialog(props: Partial<ComponentProps<typeof AssistantLibraryDialog>> = {}) {
  const [open, setOpen] = useState(true)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open library
      </button>
      <AssistantLibraryDialog open={open} onOpenChange={setOpen} onAssistantAdded={vi.fn()} {...props} />
    </>
  )
}

describe('AssistantLibraryDialog', () => {
  it('allows closing from the overlay', () => {
    const onOpenChange = vi.fn()
    renderDialog({ onOpenChange })

    screen.getByTestId('dialog-overlay').click()

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders the title, an "全部" tab plus categories, and every preset as a list row', async () => {
    renderDialog()

    expect(screen.getByText('library.assistant_catalog.title')).toBeInTheDocument()
    expect(await screen.findByText('Web Generator')).toBeInTheDocument()
    expect(screen.getByText('Chain of Thought')).toBeInTheDocument()

    const tabs = screen.getByTestId('library-tabs')
    expect(within(tabs).getByText('common.all')).toBeInTheDocument()
    expect(within(tabs).getByText('Featured')).toBeInTheDocument()
    // The catalog's "我的" tab is dropped in the library dialog.
    expect(within(tabs).queryByText('Mine')).not.toBeInTheDocument()
  })

  it('windows the full preset list with TanStack Virtual', async () => {
    assistantCatalogMocks.state.presets = Array.from({ length: 780 }, (_, index) => ({
      id: `preset-${index}`,
      name: `Preset ${index}`,
      description: `Preset description ${index}`,
      group: ['Featured']
    }))

    renderDialog()

    expect(await screen.findByText('Preset 0')).toBeInTheDocument()
    expect(virtualizerMocks.useVirtualizer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        count: 780,
        overscan: 6
      })
    )

    const virtualizerOptions = virtualizerMocks.useVirtualizer.mock.calls.at(-1)?.[0]
    expect(virtualizerOptions?.estimateSize()).toBe(70)
    expect(virtualizerOptions?.getScrollElement()).toBeInstanceOf(HTMLElement)
  })

  it('shows a loading skeleton instead of the empty state while presets load', () => {
    assistantCatalogMocks.state.isLoading = true
    assistantCatalogMocks.state.presets = []

    renderDialog()

    expect(screen.getByTestId('assistant-library-loading')).toBeInTheDocument()
    expect(screen.getAllByTestId('skeleton')).not.toHaveLength(0)
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
  })

  it('materializes a preset and swaps the row action to "go to chat"', async () => {
    const user = userEvent.setup()
    const onAssistantAdded = vi.fn()
    renderDialog({ onAssistantAdded })

    await screen.findByText('Web Generator')
    const addButtons = screen.getAllByText('library.assistant_catalog.add')
    await user.click(addButtons[0])

    await waitFor(() => expect(createFromPresetMock).toHaveBeenCalledTimes(1))
    expect(createFromPresetMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Web Generator' }))
    expect(onAssistantAdded).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('common.add_success')
    expect(await screen.findByText('library.assistant_catalog.go_to_chat')).toBeInTheDocument()
  })

  it('opens inline provider guidance instead of creating when an official vendor is unavailable', async () => {
    const user = userEvent.setup()
    const officialPreset: AssistantCatalogPresetsModule.AssistantCatalogPreset = {
      id: 'official-claude',
      name: 'Claude',
      officialVendor: 'anthropic',
      group: ['Featured']
    }
    assistantCatalogMocks.state.presets = [officialPreset]
    createFromPresetMock.mockResolvedValueOnce({ status: 'configuration-required', providerId: 'anthropic' })

    renderDialog()
    await user.click(await screen.findByText('library.assistant_catalog.add'))

    expect(await screen.findByTestId('preset-preview')).toHaveAttribute('data-configuration-provider', 'anthropic')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows provider guidance as soon as an unavailable official preset is opened', async () => {
    const user = userEvent.setup()
    const officialPreset: AssistantCatalogPresetsModule.AssistantCatalogPreset = {
      id: 'official-claude',
      name: 'Claude',
      officialVendor: 'anthropic',
      group: ['Featured']
    }
    assistantCatalogMocks.state.presets = [officialPreset]
    resolvePresetMock.mockReturnValueOnce({ status: 'configuration-required', providerId: 'anthropic' })

    renderDialog()
    await user.click(await screen.findByRole('button', { name: 'Claude' }))

    expect(await screen.findByTestId('preset-preview')).toHaveAttribute('data-configuration-provider', 'anthropic')
    expect(createFromPresetMock).not.toHaveBeenCalled()
  })

  it('keeps community presets available while dependency loading is in error and offers retry', async () => {
    const user = userEvent.setup()
    creationDependenciesMock.error = new Error('Could not load providers')
    creationDependenciesMock.isLoading = true

    renderDialog()

    expect(await screen.findByText('Web Generator')).toBeInTheDocument()
    expect(screen.getByText('common.error')).toBeInTheDocument()
    expect(screen.getByText('Could not load providers')).toBeInTheDocument()
    expect(screen.getAllByText('library.assistant_catalog.add')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'common.retry' }))
    expect(refetchCreationDependenciesMock).toHaveBeenCalledTimes(1)
  })

  it('clears added preset actions when the dialog closes', async () => {
    const user = userEvent.setup()
    render(<ControlledAssistantLibraryDialog />)

    await screen.findByText('Web Generator')
    await user.click(screen.getAllByText('library.assistant_catalog.add')[0])

    expect(await screen.findByText('library.assistant_catalog.go_to_chat')).toBeInTheDocument()

    await user.click(screen.getByTestId('dialog-overlay'))
    await waitFor(() => expect(screen.queryByTestId('assistant-library-dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'open library' }))

    expect(await screen.findByText('Web Generator')).toBeInTheDocument()
    expect(screen.queryByText('library.assistant_catalog.go_to_chat')).not.toBeInTheDocument()
    expect(screen.getAllByText('library.assistant_catalog.add')).toHaveLength(2)
  })
})
