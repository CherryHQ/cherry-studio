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
    const input = screen.getByDisplayValue('report.md') as HTMLInputElement

    fireEvent.change(input, { target: { value: '报告' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms on a normal Enter that is not part of a composition', () => {
    const onConfirm = vi.fn()
    render(<InlineRename value="report.md" onConfirm={onConfirm} onCancel={vi.fn()} />)
    const input = screen.getByDisplayValue('report.md') as HTMLInputElement

    fireEvent.change(input, { target: { value: '报告' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false })

    expect(onConfirm).toHaveBeenCalledWith('报告')
  })
})
