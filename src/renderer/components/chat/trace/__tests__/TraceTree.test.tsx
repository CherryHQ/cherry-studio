import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { TraceNode } from '../traceNode'
import TraceTree from '../TraceTree'

describe('TraceTree', () => {
  it('renders the current node duration without waiting for an effect', () => {
    const node: TraceNode = {
      id: 'span-1',
      traceId: 'trace-1',
      parentId: '',
      name: 'Current span',
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
      children: [],
      start: 0,
      percent: 100
    }

    const markup = renderToStaticMarkup(<TraceTree node={node} handleClick={vi.fn()} />)

    expect(markup).toContain('1.10s')
  })
})
