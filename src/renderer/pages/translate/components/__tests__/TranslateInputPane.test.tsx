import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dictationService, voiceTargetManager } from '@renderer/services/voice'

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

const baseProps = () => ({
  text: '',
  onTextChange: vi.fn(),
  onKeyDown: vi.fn(),
  onScroll: vi.fn(),
  onPaste: vi.fn(),
  onDrop: vi.fn(),
  onSelectFile: vi.fn(),
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

  it('shows the OCR processing overlay and supports cancellation', () => {
    const props = { ...baseProps(), ocrProcessing: true }

    render(<TranslateInputPane {...props} />)

    expect(screen.getByRole('status')).toHaveTextContent('ocr.processing')

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(props.onCancelOcr).toHaveBeenCalledTimes(1)
  })

  it('binds only after text interaction and replaces the live selection without submitting translation', () => {
    const onTranslate = vi.fn()
    const Harness = () => {
      const [text, setText] = useState('first selection')
      return <TranslateInputPane {...baseProps()} text={text} onTextChange={setText} onKeyDown={onTranslate} />
    }
    render(<Harness />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    expect(voiceTargetManager.captureCurrent()?.targetId).not.toBe('translate-page-source')
    fireEvent.focus(textarea)
    const binding = voiceTargetManager.captureCurrent()
    expect(binding?.targetId).toBe('translate-page-source')

    fireEvent.change(textarea, { target: { value: 'updated selection' } })
    textarea.setSelectionRange(8, 17)
    expect(voiceTargetManager.insert(binding!, 'spoken')).toBe('inserted')
    expect(textarea).toHaveValue('updated spoken')
    expect(textarea.selectionStart).toBe(14)
    expect(textarea.selectionEnd).toBe(14)
    expect(onTranslate).not.toHaveBeenCalled()
  })

  it('does not start dictation when the source is disabled or never focused', () => {
    const start = vi.spyOn(dictationService, 'startScoped')
    const view = render(<TranslateInputPane {...baseProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.dictation.title' }))
    expect(start).not.toHaveBeenCalled()

    view.rerender(<TranslateInputPane {...baseProps()} disabled />)
    expect(screen.getByRole('button', { name: 'chat.input.dictation.title' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.dictation.title' }))
    expect(start).not.toHaveBeenCalled()
    start.mockRestore()
  })

  it('sends a late transcript to recovery after the textarea unmounts', () => {
    const view = render(<TranslateInputPane {...baseProps()} />)
    fireEvent.focus(screen.getByRole('textbox'))
    const binding = voiceTargetManager.captureCurrent()
    expect(binding).not.toBeNull()

    view.unmount()

    expect(voiceTargetManager.insert(binding!, 'late transcript')).toBe('unavailable')
  })
})
