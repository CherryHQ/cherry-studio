import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import FileCommentBox from '../FileCommentBox'

// t returns the key so we can assert on stable identifiers instead of copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const input = (name = 'agent.preview_pane.comment.placeholder') => screen.getByRole('textbox', { name })
const button = (name: string) => screen.getByRole('button', { name })
const windowFocused = (focused: boolean) => vi.spyOn(document, 'hasFocus').mockReturnValue(focused)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FileCommentBox', () => {
  it('submits the trimmed comment with Cmd/Ctrl+Enter or the button', () => {
    const onSubmit = vi.fn()
    render(<FileCommentBox onSubmit={onSubmit} onCancel={vi.fn()} />)

    fireEvent.change(input(), { target: { value: '  Rename this  ' } })
    fireEvent.click(button('agent.preview_pane.comment.submit'))

    expect(onSubmit).toHaveBeenCalledWith('Rename this')
  })

  it('cannot submit an empty comment', () => {
    const onSubmit = vi.fn()
    render(<FileCommentBox onSubmit={onSubmit} onCancel={vi.fn()} />)

    fireEvent.change(input(), { target: { value: '   ' } })
    fireEvent.keyDown(input(), { key: 'Enter', metaKey: true })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(button('agent.preview_pane.comment.submit')).toBeDisabled()
  })

  it('quotes without a comment when empty submissions are allowed, and comments once text is typed', () => {
    const onSubmit = vi.fn()
    render(<FileCommentBox allowEmpty onSubmit={onSubmit} onCancel={vi.fn()} />)

    expect(button('agent.preview_pane.comment.quote')).toBeEnabled()
    fireEvent.change(input('agent.preview_pane.comment.placeholder_optional'), { target: { value: 'Tighten' } })
    expect(button('agent.preview_pane.comment.submit')).toBeEnabled()
    fireEvent.change(input('agent.preview_pane.comment.placeholder_optional'), { target: { value: '' } })
    fireEvent.keyDown(input('agent.preview_pane.comment.placeholder_optional'), { key: 'Enter', ctrlKey: true })

    expect(onSubmit).toHaveBeenCalledWith('')
  })

  it('cancels on Escape without letting the key reach the surrounding pane', () => {
    const onCancel = vi.fn()
    const onPaneKeyDown = vi.fn()
    render(
      <div onKeyDown={onPaneKeyDown}>
        <FileCommentBox onSubmit={vi.fn()} onCancel={onCancel} />
      </div>
    )

    fireEvent.keyDown(input(), { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledExactlyOnceWith('escape')
    expect(onPaneKeyDown).not.toHaveBeenCalled()
  })

  it('cancels when focus moves elsewhere in the window, but not to its own button', () => {
    windowFocused(true)
    const onCancel = vi.fn()
    render(<FileCommentBox onSubmit={vi.fn()} onCancel={onCancel} />)

    fireEvent.focusOut(input(), { relatedTarget: button('agent.preview_pane.comment.submit') })
    expect(onCancel).not.toHaveBeenCalled()

    fireEvent.focusOut(input(), { relatedTarget: document.body })
    expect(onCancel).toHaveBeenCalledExactlyOnceWith('blur')
  })

  it('keeps the draft when the whole window loses focus', () => {
    windowFocused(false)
    const onCancel = vi.fn()
    render(<FileCommentBox onSubmit={vi.fn()} onCancel={onCancel} />)

    fireEvent.focusOut(input())

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('does not also cancel when the field loses focus after a submit', () => {
    windowFocused(true)
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<FileCommentBox onSubmit={onSubmit} onCancel={onCancel} />)

    fireEvent.change(input(), { target: { value: 'Done' } })
    fireEvent.keyDown(input(), { key: 'Enter', metaKey: true })
    fireEvent.focusOut(input())

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
