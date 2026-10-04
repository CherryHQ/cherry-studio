import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { dictationService, voiceService, voiceTargetManager } from '@renderer/services/voice'
import type { InputFor } from '@shared/ipc/types'

import TranslateInputPane from '../TranslateInputPane'

const dragState = vi.hoisted(() => ({ isDragging: false }))

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
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  afterEach(async () => {
    dragState.isDragging = false
    await act(async () => {
      await dictationService.teardown()
      await voiceService.teardown()
    })
    vi.restoreAllMocks()
  })

  it('disables file upload while the parent pane is disabled', () => {
    const props = baseProps()
    render(<TranslateInputPane {...props} disabled />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('translate.files.upload') }))

    expect(screen.getByRole('button', { name: i18n.t('translate.files.upload') })).toBeDisabled()
    expect(props.onSelectFile).not.toHaveBeenCalled()
  })

  it('shows the input value and hides the upload area once input has text', () => {
    const props = baseProps()
    props.text = 'hello'

    render(<TranslateInputPane {...props} />)

    expect(screen.queryByRole('button', { name: i18n.t('translate.files.upload') })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('hello')
  })

  it('clears the input when the clear button is clicked', () => {
    const props = baseProps()
    props.text = 'hello'

    render(<TranslateInputPane {...props} />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.clear') }))

    expect(props.onTextChange).toHaveBeenCalledWith('')
  })

  it('hides the clear button when there is no text', () => {
    render(<TranslateInputPane {...baseProps()} />)

    expect(screen.queryByRole('button', { name: i18n.t('common.clear') })).not.toBeInTheDocument()
  })

  it('shows the drop indicator while a file is dragged over the pane', () => {
    dragState.isDragging = true

    render(<TranslateInputPane {...baseProps()} />)

    expect(screen.getByText(i18n.t('translate.files.drag_text'))).toBeInTheDocument()
  })

  it('does not show the OCR processing overlay by default', () => {
    render(<TranslateInputPane {...baseProps()} />)

    expect(screen.queryByText(i18n.t('ocr.processing'))).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: i18n.t('common.cancel') })).not.toBeInTheDocument()
  })

  it('shows the OCR processing overlay and supports cancellation', () => {
    const props = { ...baseProps(), ocrProcessing: true }

    render(<TranslateInputPane {...props} />)

    expect(screen.getByRole('status')).toHaveTextContent(i18n.t('ocr.processing'))

    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))

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

  it('starts capture in the source pane when its microphone is clicked before text interaction', async () => {
    const user = userEvent.setup()
    mockPreferenceState.set('feature.voice.recognition.model_id', '')
    mockPreferenceState.set('feature.voice.recognition.language', 'en-US')
    const request = vi.mocked(window.api.ipcApi.request)
    request.mockImplementation(async (route, input) => {
      if (route === 'ai.voice.session.state') return { ok: true, data: { phase: 'idle', revision: 1 } }
      if (route === 'ai.voice.recording.start') {
        const { sessionId } = input as InputFor<'ai.voice.recording.start'>
        return { ok: true, data: { phase: 'recording', revision: 2, sessionId } }
      }
      if (route === 'ai.voice.session.discard') return { ok: true, data: undefined }
      throw new Error(`Unexpected IPC route: ${route}`)
    })
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    const unbind = voiceTargetManager.bind({
      targetId: 'previous-input',
      owner: window,
      sourceEntityId: 'previous-input',
      captureReplaceRange: () => ({ from: 0, to: 0 }),
      replaceRange: () => true
    })
    voiceTargetManager.markCurrent('previous-input')

    try {
      render(<TranslateInputPane {...baseProps()} />)
      await user.click(screen.getByRole('button', { name: i18n.t('chat.input.dictation.title') }))

      await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }))
      expect(screen.getByRole('textbox')).toHaveFocus()
      expect(voiceTargetManager.captureCurrent()?.targetId).toBe('translate-page-source')
      expect(request).toHaveBeenCalledWith(
        'ai.voice.recording.start',
        expect.objectContaining({ sourceEntityId: 'translate-page-source' })
      )
    } finally {
      unbind()
      request.mockReset()
      if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
      else Reflect.deleteProperty(navigator, 'mediaDevices')
    }
  })

  it('keeps dictation unavailable while the source is disabled', () => {
    render(<TranslateInputPane {...baseProps()} disabled />)
    expect(screen.getByRole('button', { name: i18n.t('chat.input.dictation.title') })).toBeDisabled()
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
