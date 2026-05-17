import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import TraceTree from '../TraceTree'

// mock antd Divider
vi.mock('antd/lib', () => ({
  Divider: ({ style }: any) => <hr style={style} />
}))

describe('TraceTree', () => {
  const createNode = (name: string, overrides?: Partial<any>): any => ({
    id: 'test-id',
    name,
    status: 'OK',
    startTime: Date.now(),
    endTime: Date.now() + 100,
    percent: 10,
    start: 0,
    children: [],
    ...overrides
  })

  it('should render node name with text-ellipsis class and title tooltip', () => {
    const longName = 'This is a very long span name that should be truncated with ellipsis'
    const node = createNode(longName)

    render(<TraceTree node={node} handleClick={vi.fn()} />)

    const nameElement = screen.getByText(longName)
    expect(nameElement).toBeInTheDocument()
    expect(nameElement).toHaveAttribute('title', longName)
    expect(nameElement).toHaveClass('text-ellipsis')
  })

  it('should apply error-text class for ERROR status', () => {
    const node = createNode('error-node', { status: 'ERROR' })

    render(<TraceTree node={node} handleClick={vi.fn()} />)

    const nameElement = screen.getByText('error-node')
    expect(nameElement).toHaveClass('error-text')
  })

  it('should apply default-text class for OK status', () => {
    const node = createNode('ok-node', { status: 'OK' })

    render(<TraceTree node={node} handleClick={vi.fn()} />)

    const nameElement = screen.getByText('ok-node')
    expect(nameElement).toHaveClass('default-text')
  })

  it('should render children when expanded', () => {
    const childNode = createNode('child-node', { id: 'child-id' })
    const parentNode = createNode('parent-node', { children: [childNode] })

    render(<TraceTree node={parentNode} handleClick={vi.fn()} />)

    expect(screen.getByText('parent-node')).toBeInTheDocument()
    expect(screen.getByText('child-node')).toBeInTheDocument()
  })

  it('should handle click on node', () => {
    const handleClick = vi.fn()
    const node = createNode('clickable-node')

    render(<TraceTree node={node} handleClick={handleClick} />)

    const row = screen.getByText('clickable-node').closest('.traceItem')
    expect(row).toBeInTheDocument()
    fireEvent.click(row!)
    expect(handleClick).toHaveBeenCalledTimes(1)
    expect(handleClick).toHaveBeenCalledWith('test-id')
  })
})
