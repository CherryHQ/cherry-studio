import { render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { TraceNode } from '../traceNode'
import TraceTree from '../TraceTree'

const createTraceNode = (id: string, name: string, children: TraceNode[] = []): TraceNode => ({
  id,
  traceId: 'trace-1',
  parentId: '',
  name,
  status: 'OK',
  kind: 'LLM',
  topicId: 'topic-1',
  modelName: 'model-1',
  startTime: 1000,
  endTime: 2100,
  isEnd: true,
  attributes: {},
  events: [],
  links: [],
  children,
  start: 0,
  percent: 100
})

describe('TraceTree', () => {
  it('renders the current node duration without waiting for an effect', () => {
    const markup = renderToStaticMarkup(
      <TraceTree node={createTraceNode('span-1', 'Current span')} handleClick={vi.fn()} />
    )

    expect(markup).toContain('1.10s')
  })

  it('contains expanded trace rows without containing their recursive subtree', () => {
    const child = createTraceNode('child', 'Child span')
    const parent = createTraceNode('parent', 'Parent span', [child])
    const { container, getByText } = render(<TraceTree node={parent} handleClick={vi.fn()} />)
    const containedRows = Array.from(container.querySelectorAll<HTMLElement>('[style]')).filter(
      (element) => element.style.contentVisibility === 'auto'
    )

    expect(container.firstElementChild).not.toHaveStyle({ contentVisibility: 'auto' })
    expect(containedRows).toHaveLength(2)
    expect(containedRows[0]).toHaveStyle({ contentVisibility: 'auto', containIntrinsicSize: 'auto 32px' })
    expect(containedRows[0]).toContainElement(getByText('Parent span'))
    expect(containedRows[0]).not.toContainElement(getByText('Child span'))
    expect(containedRows[1]).toHaveStyle({ contentVisibility: 'auto', containIntrinsicSize: 'auto 32px' })
    expect(containedRows[1]).toContainElement(getByText('Child span'))
  })
})
