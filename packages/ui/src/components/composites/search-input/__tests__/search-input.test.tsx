// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SearchInput } from '../index'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SearchInput', () => {
  it('renders a search field with the given placeholder', () => {
    render(<SearchInput placeholder="搜索" value="" onChange={() => {}} />)

    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', '搜索')
  })

  it('calls onChange when the user types', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cherry' } })

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('shows the clear button only when onClear is set and the value is non-empty', () => {
    const { rerender } = render(<SearchInput value="" onChange={() => {}} onClear={() => {}} clearLabel="清除" />)
    expect(screen.queryByRole('button', { name: '清除' })).not.toBeInTheDocument()

    rerender(<SearchInput value="cherry" onChange={() => {}} onClear={() => {}} clearLabel="清除" />)
    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument()
  })

  it('hides the clear button when no onClear handler is provided', () => {
    render(<SearchInput value="cherry" onChange={() => {}} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('invokes onClear when the clear button is clicked', () => {
    const onClear = vi.fn()
    render(<SearchInput value="cherry" onChange={() => {}} onClear={onClear} clearLabel="清除" />)

    fireEvent.click(screen.getByRole('button', { name: '清除' }))

    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('disables the input and the clear button when disabled', () => {
    render(<SearchInput value="cherry" onChange={() => {}} onClear={() => {}} clearLabel="清除" disabled />)

    expect(screen.getByRole('searchbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: '清除' })).toBeDisabled()
  })

  it('supports a custom clear button label', () => {
    render(<SearchInput value="cherry" onChange={() => {}} onClear={() => {}} clearLabel="清除" />)

    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument()
  })
})
