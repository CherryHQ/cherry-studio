import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { formatArgValue, ToolArgsTable } from '../ArgsTable'

describe('formatArgValue', () => {
  it('formats primitive values for display', () => {
    expect(formatArgValue(null)).toBe('null')
    expect(formatArgValue(undefined)).toBe('')
    expect(formatArgValue('hello')).toBe('hello')
    expect(formatArgValue(12)).toBe('12')
    expect(formatArgValue(false)).toBe('false')
  })

  it('serializes object and array values as JSON', () => {
    expect(formatArgValue({ path: 'src/file.ts' })).toBe('{"path":"src/file.ts"}')
    expect(formatArgValue(['a', 'b'])).toBe('["a","b"]')
  })
})

describe('ToolArgsTable', () => {
  it('renders object arguments with an optional title', () => {
    render(<ToolArgsTable title="Arguments" args={{ path: 'src/file.ts', count: 2 }} />)

    expect(screen.getByText('Arguments')).toBeInTheDocument()
    expect(screen.getByText('path')).toBeInTheDocument()
    expect(screen.getByText('src/file.ts')).toBeInTheDocument()
    expect(screen.getByText('count')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders array arguments as a single arguments row', () => {
    render(<ToolArgsTable args={['one', 'two']} />)

    expect(screen.getByText('arguments')).toBeInTheDocument()
    expect(screen.getByText('["one","two"]')).toBeInTheDocument()
  })

  it('omits empty argument tables unless streaming placeholders are needed', () => {
    const { container, rerender } = render(<ToolArgsTable args={{}} />)
    expect(container).toBeEmptyDOMElement()

    rerender(<ToolArgsTable args={{}} isStreaming />)
    expect(container.querySelectorAll('.inline-block')).toHaveLength(2)
  })
})
