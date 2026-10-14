import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import MultiSelectActionPopup from '../MultiSelectActionPopup'
import { defaultMessageMenuExportOptions } from '../types'
import type { MessageMenuExportOptions } from '../types'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  // Keep the real Checkbox: tri-state and interaction assertions must cover
  // the actual UI primitive, not a locally reimplemented stand-in.
  const actual = await importOriginal<typeof CherryStudioUi>()
  return {
    ...actual,
    Button: ({ children, disabled, onClick }: any) => (
      <button type="button" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
    Tooltip: ({ children, content }: any) => <span data-tooltip-content={content}>{children}</span>
  }
})

vi.mock('@renderer/components/icons/CopyIcon', () => ({
  default: () => <span data-testid="copy-icon" />
}))

vi.mock('@renderer/components/icons/DeleteIcon', () => ({
  default: () => <span data-testid="delete-icon" />
}))

vi.mock('lucide-react', () => ({
  Save: () => <span data-testid="save-icon" />,
  Upload: () => <span data-testid="upload-icon" />,
  X: () => <span data-testid="close-icon" />
}))

// Composition boundary: the menu chrome belongs to the command suite —
// items render as plain buttons pinning only labels and forwarded targets.
vi.mock('@renderer/components/command', () => ({
  CommandPopupMenu: ({ children, extraItems }: any) => (
    <div data-testid="export-menu">
      {children}
      {extraItems.map((item: any, index: number) =>
        item.type === 'separator' ? (
          <hr key={`separator-${index}`} />
        ) : (
          <button key={item.id} type="button" onClick={item.onSelect}>
            {item.label}
          </button>
        )
      )}
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`)
  })
}))

const buttonFor = (testId: string) => screen.getByTestId(testId).closest('button') as HTMLButtonElement

describe('MultiSelectionPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('controlled mode (v2 message renderer drives state)', () => {
    const controlledProps = () => ({
      selectedMessageIds: ['m1', 'm2'],
      isMultiSelectMode: true,
      onSave: vi.fn(),
      onCopy: vi.fn(),
      onDelete: vi.fn(),
      onClose: vi.fn()
    })

    it('renders nothing when not in multi-select mode', () => {
      const { container } = render(<MultiSelectActionPopup {...controlledProps()} isMultiSelectMode={false} />)
      expect(container).toBeEmptyDOMElement()
    })

    it('renders the selection count and wires the explicit handlers, without touching ChatContext', () => {
      const props = controlledProps()
      render(<MultiSelectActionPopup {...props} />)

      expect(screen.getByText('common.selectedMessages:2')).toBeInTheDocument()

      fireEvent.click(buttonFor('save-icon'))
      fireEvent.click(buttonFor('copy-icon'))
      fireEvent.click(buttonFor('delete-icon'))
      fireEvent.click(buttonFor('close-icon'))

      expect(props.onSave).toHaveBeenCalledTimes(1)
      expect(props.onCopy).toHaveBeenCalledTimes(1)
      expect(props.onDelete).toHaveBeenCalledTimes(1)
      expect(props.onClose).toHaveBeenCalledTimes(1)
    })

    it('disables the actions when nothing is selected (isActionDisabled = length === 0)', () => {
      render(<MultiSelectActionPopup {...controlledProps()} selectedMessageIds={[]} />)
      expect(buttonFor('save-icon')).toBeDisabled()
      expect(buttonFor('copy-icon')).toBeDisabled()
      expect(buttonFor('delete-icon')).toBeDisabled()
    })

    it.each([
      ['not-loaded', 'message.delete.root_unavailable'],
      ['generating', 'message.delete.generating_unavailable']
    ] as const)('disables only deletion for %s', (deleteDisabledReason, tooltip) => {
      render(<MultiSelectActionPopup {...controlledProps()} deleteDisabledReason={deleteDisabledReason} />)

      expect(buttonFor('save-icon')).toBeEnabled()
      expect(buttonFor('copy-icon')).toBeEnabled()
      expect(buttonFor('delete-icon')).toBeDisabled()
      expect(buttonFor('delete-icon').parentElement).toHaveAttribute('data-tooltip-content', tooltip)
    })

    it('omits a button when its handler is not provided', () => {
      render(<MultiSelectActionPopup {...controlledProps()} onSave={undefined} />)
      expect(screen.queryByTestId('save-icon')).not.toBeInTheDocument()
      expect(screen.getByTestId('copy-icon')).toBeInTheDocument()
    })
  })

  describe('select-all checkbox', () => {
    const popupProps = () => ({
      selectedMessageIds: ['m1', 'm2'],
      isMultiSelectMode: true,
      onClose: vi.fn()
    })

    it('renders left of the selection count with a select-all label', () => {
      render(<MultiSelectActionPopup {...popupProps()} selectAllState={false} onToggleSelectAll={vi.fn()} />)

      const checkbox = screen.getByRole('checkbox', { name: 'common.select_all' })
      const count = screen.getByText('common.selectedMessages:2')
      expect(checkbox.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it.each([
      [false, 'unchecked'],
      ['indeterminate', 'indeterminate'],
      [true, 'checked']
    ] as const)('renders the real checkbox in %s state', (selectAllState, expectedState) => {
      render(<MultiSelectActionPopup {...popupProps()} selectAllState={selectAllState} onToggleSelectAll={vi.fn()} />)

      expect(screen.getByRole('checkbox')).toHaveAttribute('data-state', expectedState)
    })

    it.each([
      ['from unchecked', false, true],
      ['from indeterminate', 'indeterminate', true],
      ['from checked', true, false]
    ] as const)('toggles %s', async (_label, selectAllState, expectedChecked) => {
      const onToggleSelectAll = vi.fn()
      const user = userEvent.setup()
      render(
        <MultiSelectActionPopup
          {...popupProps()}
          selectAllState={selectAllState}
          onToggleSelectAll={onToggleSelectAll}
        />
      )

      await user.click(screen.getByRole('checkbox'))

      expect(onToggleSelectAll).toHaveBeenCalledWith(expectedChecked)
    })

    it('disables the checkbox when no messages are selectable', () => {
      render(
        <MultiSelectActionPopup
          {...popupProps()}
          selectAllState={false}
          selectAllDisabled
          onToggleSelectAll={vi.fn()}
        />
      )

      expect(screen.getByRole('checkbox')).toBeDisabled()
    })

    it('omits the checkbox when no toggle handler is provided', () => {
      render(<MultiSelectActionPopup {...popupProps()} />)

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })
  })

  describe('export menu', () => {
    const exportProps = (overrides = {}) => ({
      selectedMessageIds: ['m1', 'm2'],
      isMultiSelectMode: true,
      onExport: vi.fn(),
      exportMenuOptions: {
        ...defaultMessageMenuExportOptions,
        markdown: true,
        markdown_reason: true,
        docx: true,
        notion: true,
        yuque: true,
        obsidian: true,
        joplin: true,
        siyuan: true
      } satisfies MessageMenuExportOptions,
      onClose: vi.fn(),
      ...overrides
    })

    it('offers the enabled destinations and forwards the chosen target', async () => {
      const props = exportProps()
      const user = userEvent.setup()
      render(<MultiSelectActionPopup {...props} />)

      expect(buttonFor('upload-icon')).toBeEnabled()
      for (const label of [
        'chat.topics.export.md.label',
        'chat.topics.export.md.reason',
        'chat.topics.export.word',
        'chat.topics.export.notion',
        'chat.topics.export.yuque',
        'chat.topics.export.obsidian',
        'chat.topics.export.joplin',
        'chat.topics.export.siyuan'
      ]) {
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
      }

      await user.click(screen.getByRole('button', { name: 'chat.topics.export.md.label' }))
      await user.click(screen.getByRole('button', { name: 'chat.topics.export.notion' }))

      expect(props.onExport).toHaveBeenNthCalledWith(1, 'markdown')
      expect(props.onExport).toHaveBeenNthCalledWith(2, 'notion')
    })

    it('limits the menu to the enabled destinations', () => {
      render(
        <MultiSelectActionPopup
          {...exportProps({
            exportMenuOptions: { ...defaultMessageMenuExportOptions, markdown: true, joplin: true }
          })}
        />
      )

      expect(screen.getByRole('button', { name: 'chat.topics.export.md.label' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'chat.topics.export.joplin' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'chat.topics.export.word' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'chat.topics.export.notion' })).not.toBeInTheDocument()
    })

    it('omits the export button when no export handler is provided', () => {
      render(<MultiSelectActionPopup {...exportProps({ onExport: undefined })} />)

      expect(screen.queryByTestId('upload-icon')).not.toBeInTheDocument()
    })

    it('omits the export button when every export option is off', () => {
      render(<MultiSelectActionPopup {...exportProps({ exportMenuOptions: { ...defaultMessageMenuExportOptions } })} />)

      expect(screen.queryByTestId('upload-icon')).not.toBeInTheDocument()
    })

    it('disables the export button when nothing is selected', () => {
      render(<MultiSelectActionPopup {...exportProps({ selectedMessageIds: [] })} />)

      expect(buttonFor('upload-icon')).toBeDisabled()
    })

    it('disables the export button while select-all is still loading older pages', () => {
      render(<MultiSelectActionPopup {...exportProps({ isSelectAllLoading: true })} />)

      expect(buttonFor('upload-icon')).toBeDisabled()
    })
  })
})
