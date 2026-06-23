import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TranslateInputPane from '../TranslateInputPane'

const dragState = vi.hoisted(() => ({ isDragging: false }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useDrag', () => ({
  useDrag: (onDrop: (event: React.DragEvent<HTMLDivElement>) => void) => ({
    isDragging: dragState.isDragging,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: onDrop
  })
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  NormalTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

const baseProps = () => ({
  text: '',
  onTextChange: vi.fn(),
  onKeyDown: vi.fn(),
  onScroll: vi.fn(),
  onPaste: vi.fn(),
  onDrop: vi.fn(),
  onSelectFile: vi.fn(),
  onCopy: vi.fn(),
  onCancelOcr: vi.fn(),
  disabled: false,
  ocrProcessing: false,
  selecting: false
})

describe('TranslateInputPane', () => {
  afterEach(() => {
    dragState.isDragging = false
  })

  it('disables file upload while the parent pane is disabled', () => {
    const props = baseProps()
    render(<TranslateInputPane {...props} disabled />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.files.upload' }))

    expect(screen.getByRole('button', { name: 'translate.files.upload' })).toBeDisabled()
    expect(props.onSelectFile).not.toHaveBeenCalled()
  })

  it('hides the upload area once input has text', () => {
    const props = baseProps()
    props.text = 'hello'

    render(<TranslateInputPane {...props} />)

    expect(screen.queryByRole('button', { name: 'translate.files.upload' })).not.toBeInTheDocument()
  })

  it('clears the input when the clear button is clicked', () => {
    const props = baseProps()
    props.text = 'hello'

    render(<TranslateInputPane {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.clear' }))

    expect(props.onTextChange).toHaveBeenCalledWith('')
  })

  it('hides the clear button when there is no text', () => {
    render(<TranslateInputPane {...baseProps()} />)

    expect(screen.queryByRole('button', { name: 'common.clear' })).not.toBeInTheDocument()
  })

  it('shows the drop indicator while a file is dragged over the pane', () => {
    dragState.isDragging = true

    render(<TranslateInputPane {...baseProps()} />)

    expect(screen.getByText('translate.files.drag_text')).toBeInTheDocument()
  })

  it('does not show the OCR processing overlay by default', () => {
    render(<TranslateInputPane {...baseProps()} />)

    expect(screen.queryByText('ocr.processing')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.cancel' })).not.toBeInTheDocument()
  })

  it('shows the OCR processing overlay while OCR is running', () => {
    const props = { ...baseProps(), ocrProcessing: true }

    render(<TranslateInputPane {...props} />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('ocr.processing')
    expect(status.querySelector('svg')).toBeInTheDocument()
  })

  it('calls the OCR cancel handler from the processing overlay', () => {
    const props = { ...baseProps(), ocrProcessing: true }

    render(<TranslateInputPane {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(props.onCancelOcr).toHaveBeenCalledTimes(1)
  })
})
