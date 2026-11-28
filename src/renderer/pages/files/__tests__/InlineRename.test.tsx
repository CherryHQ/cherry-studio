// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InlineRename } from '../InlineRename'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('InlineRename', () => {
  it('does not confirm on the Enter that commits an IME composition', () => {
    const onConfirm = vi.fn()
    render(<InlineRename value="report.md" onConfirm={onConfirm} onCancel={vi.fn()} />)
    const input = screen.getByDisplayValue<HTMLInputElement>('report.md')

    fireEvent.change(input, { target: { value: '报告' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not confirm on an IME Enter reported only through keyCode 229', () => {
    const onConfirm = vi.fn()
    render(<InlineRename value="report.md" onConfirm={onConfirm} onCancel={vi.fn()} />)
    const input = screen.getByDisplayValue<HTMLInputElement>('report.md')

    fireEvent.change(input, { target: { value: '报告' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms only once when the user moves focus before a keyboard rename finishes', () => {
    const onConfirm = vi.fn()
    render(<InlineRename value="report.md" onConfirm={onConfirm} onCancel={vi.fn()} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'summary.md' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('summary.md')
  })

  it('does not confirm a cancelled edit on blur', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<InlineRename value="report.md" onConfirm={onConfirm} onCancel={onCancel} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'summary.md' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms on a normal Enter that is not part of a composition', () => {
    const onConfirm = vi.fn()
    render(<InlineRename value="report.md" onConfirm={onConfirm} onCancel={vi.fn()} />)
    const input = screen.getByDisplayValue<HTMLInputElement>('report.md')

    fireEvent.change(input, { target: { value: '报告' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false })

    expect(onConfirm).toHaveBeenCalledWith('报告')
  })
})
