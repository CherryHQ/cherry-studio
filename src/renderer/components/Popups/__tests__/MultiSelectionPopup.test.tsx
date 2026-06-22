import type { Topic } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MultiSelectActionPopup from '../MultiSelectionPopup'

const mocks = vi.hoisted(() => ({
  chatContext: {
    toggleMultiSelectMode: vi.fn(),
    selectedMessageIds: [] as string[],
    isMultiSelectMode: false,
    handleMultiSelectAction: vi.fn()
  }
}))

vi.mock('@renderer/hooks/useChatContext', () => ({
  useChatContext: () => mocks.chatContext
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, disabled, onClick }: any) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => <>{children}</>
}))

vi.mock('@renderer/components/Icons', () => ({
  CopyIcon: () => <span data-testid="copy-icon" />,
  DeleteIcon: () => <span data-testid="delete-icon" />
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
    mocks.chatContext.selectedMessageIds = []
    mocks.chatContext.isMultiSelectMode = false
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
      // the controlled branch must NOT fall back to the v1 ChatContext
      expect(mocks.chatContext.handleMultiSelectAction).not.toHaveBeenCalled()
      expect(mocks.chatContext.toggleMultiSelectMode).not.toHaveBeenCalled()
    })

    it('disables the actions when nothing is selected (isActionDisabled = length === 0)', () => {
      render(<MultiSelectActionPopup {...controlledProps()} selectedMessageIds={[]} />)
      expect(buttonFor('save-icon')).toBeDisabled()
      expect(buttonFor('copy-icon')).toBeDisabled()
      expect(buttonFor('delete-icon')).toBeDisabled()
    })

    it('omits a button when its handler is not provided', () => {
      render(<MultiSelectActionPopup {...controlledProps()} onSave={undefined} />)
      expect(screen.queryByTestId('save-icon')).not.toBeInTheDocument()
      expect(screen.getByTestId('copy-icon')).toBeInTheDocument()
    })
  })

  describe('legacy mode (v1 reads from ChatContext)', () => {
    it('reads selection from useChatContext and dispatches through handleMultiSelectAction', () => {
      mocks.chatContext.isMultiSelectMode = true
      mocks.chatContext.selectedMessageIds = ['a', 'b', 'c']

      render(<MultiSelectActionPopup topic={{ id: 't1' } as Topic} />)

      expect(screen.getByText('common.selectedMessages:3')).toBeInTheDocument()

      fireEvent.click(buttonFor('save-icon'))
      fireEvent.click(buttonFor('copy-icon'))
      fireEvent.click(buttonFor('delete-icon'))
      fireEvent.click(buttonFor('close-icon'))

      expect(mocks.chatContext.handleMultiSelectAction).toHaveBeenCalledWith('save', ['a', 'b', 'c'])
      expect(mocks.chatContext.handleMultiSelectAction).toHaveBeenCalledWith('copy', ['a', 'b', 'c'])
      expect(mocks.chatContext.handleMultiSelectAction).toHaveBeenCalledWith('delete', ['a', 'b', 'c'])
      expect(mocks.chatContext.toggleMultiSelectMode).toHaveBeenCalledWith(false)
    })

    it('keeps actions enabled even with an empty selection (legacy divergence: isActionDisabled = false)', () => {
      mocks.chatContext.isMultiSelectMode = true
      mocks.chatContext.selectedMessageIds = []

      render(<MultiSelectActionPopup topic={{ id: 't1' } as Topic} />)

      expect(buttonFor('save-icon')).not.toBeDisabled()
    })

    it('renders nothing when ChatContext is not in multi-select mode', () => {
      mocks.chatContext.isMultiSelectMode = false
      const { container } = render(<MultiSelectActionPopup topic={{ id: 't1' } as Topic} />)
      expect(container).toBeEmptyDOMElement()
    })
  })
})
