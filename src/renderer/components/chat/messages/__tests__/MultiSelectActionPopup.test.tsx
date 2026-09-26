import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import MultiSelectActionPopup from '../MultiSelectActionPopup'

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
  X: () => <span data-testid="close-icon" />
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
})
