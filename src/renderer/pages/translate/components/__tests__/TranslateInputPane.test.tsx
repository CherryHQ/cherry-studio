import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
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

vi.mock('@renderer/utils/style', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Scrollbar: ({ children, ref, ...props }: React.ComponentProps<'div'> & { ref?: React.Ref<HTMLDivElement> }) => (
    <div ref={ref} {...props}>
      {children}
    </div>
  ),
  NormalTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

const baseProps = (): React.ComponentProps<typeof TranslateInputPane> => ({
  text: '',
  onTextChange: vi.fn(),
  onKeyDown: vi.fn(),
  onScroll: vi.fn(),
  onPaste: vi.fn(),
  onDrop: vi.fn(),
  onSelectFile: vi.fn(),
  clipboardImage: null,
  onRemoveClipboardImage: vi.fn(),
  onReplaceClipboardImage: vi.fn(),
  copied: false,
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

  it('shows the input value and hides the upload area once input has text', () => {
    const props = baseProps()
    props.text = 'hello'

    render(<TranslateInputPane {...props} />)

    expect(screen.queryByRole('button', { name: 'translate.files.upload' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('hello')
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

  it('swaps the copy icon for a check once the text has been copied', () => {
    const { rerender } = render(<TranslateInputPane {...baseProps()} text="hello" />)

    expect(screen.getByRole('button', { name: 'common.copy' }).querySelector('.lucide-check')).toBeNull()

    rerender(<TranslateInputPane {...baseProps()} text="hello" copied />)

    expect(screen.getByRole('button', { name: 'common.copy' }).querySelector('.lucide-check')).not.toBeNull()
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

  it('shows clipboard image preview with remove and replace controls', () => {
    const props = baseProps()
    props.clipboardImage = { path: '/tmp/shot.png' as any, name: 'shot.png' }

    render(<TranslateInputPane {...props} />)

    expect(screen.getByTestId('translate-clipboard-image-preview')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'translate.files.upload' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'translate.image.remove' }))
    expect(props.onRemoveClipboardImage).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'translate.image.replace' }))
    expect(props.onReplaceClipboardImage).toHaveBeenCalledTimes(1)
  })

  it('shows the OCR processing overlay and supports cancellation', () => {
    const props = { ...baseProps(), ocrProcessing: true }

    render(<TranslateInputPane {...props} />)

    expect(screen.getByRole('status')).toHaveTextContent('ocr.processing')

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(props.onCancelOcr).toHaveBeenCalledTimes(1)
  })
})
