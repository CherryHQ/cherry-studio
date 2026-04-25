import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RecallTestPanel from '../RecallTestPanel'

const mockKnowledgeRuntimeSearch = vi.fn()
const mockPerformanceNow = vi.spyOn(performance, 'now')
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn()
}))
const mockCache = vi.hoisted(() => ({
  initial: {
    'base-1': ['RAG 检索增强生成原理', '向量数据库选型对比'],
    'base-2': ['其他知识库查询']
  } as Record<string, string[]>,
  set: vi.fn()
}))

const realSearchResults = [
  {
    pageContent: 'real result from file name',
    score: 0.98,
    metadata: {
      itemId: 'item-1',
      itemType: 'file',
      source: '/Users/test/Downloads/真实文档.pdf',
      name: '真实文档.pdf',
      chunkIndex: 3,
      tokenCount: 120
    },
    itemId: 'item-1',
    chunkId: 'chunk-1'
  },
  {
    pageContent: 'real result from file path',
    score: 76,
    metadata: {
      itemId: 'item-2',
      itemType: 'file',
      source: '/Users/test/Downloads/路径文档.md',
      name: '路径文档.md',
      chunkIndex: 2,
      tokenCount: 80
    },
    itemId: 'item-2',
    chunkId: 'chunk-2'
  }
]

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: mockLogger.info,
      error: mockLogger.error
    })
  }
}))

vi.mock('@cherrystudio/ui', async () => {
  return {
    Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <button {...props}>{children}</button>
    ),
    Input: (props: { [key: string]: unknown }) => <input {...props} />
  }
})

vi.mock('@data/hooks/useCache', async () => {
  const React = await import('react')

  return {
    useCache: () => {
      const [value, setValue] = React.useState(mockCache.initial)

      return [
        value,
        (nextValue: Record<string, string[]>) => {
          mockCache.set(nextValue)
          setValue(nextValue)
        }
      ]
    }
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; duration?: number; score?: number | string }) =>
      (
        ({
          'knowledge_v2.recall.collapse': '收起片段',
          'knowledge_v2.recall.copy': '复制片段',
          'knowledge_v2.recall.duration': `${options?.duration ?? 0}ms`,
          'knowledge_v2.recall.empty_description': '结果将展示匹配的文档片段和分数',
          'knowledge_v2.recall.empty_title': '输入查询语句开始检索测试',
          'knowledge_v2.recall.expand': '展开片段',
          'knowledge_v2.recall.history_clear': '清空',
          'knowledge_v2.recall.history_remove': '删除历史',
          'knowledge_v2.recall.history_title': '搜索历史',
          'knowledge_v2.recall.placeholder': '输入测试 Query...',
          'knowledge_v2.recall.result_count': `${options?.count ?? 0} 个结果`,
          'knowledge_v2.recall.searching': '正在检索...',
          'knowledge_v2.recall.submit': '检索',
          'knowledge_v2.recall.top_score': `最高: ${options?.score ?? 0}`
        }) as Record<string, string>
      )[key] ?? key
  })
}))

describe('RecallTestPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCache.initial = {
      'base-1': ['RAG 检索增强生成原理', '向量数据库选型对比'],
      'base-2': ['其他知识库查询']
    }
    mockPerformanceNow.mockReturnValue(100)
    mockKnowledgeRuntimeSearch.mockResolvedValue(realSearchResults)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        knowledgeRuntime: {
          search: mockKnowledgeRuntimeSearch
        }
      }
    })
  })

  it('renders the empty state with a disabled search button initially', () => {
    render(<RecallTestPanel baseId="base-1" />)

    expect(screen.getByText('输入查询语句开始检索测试')).toBeInTheDocument()
    expect(screen.getByText('结果将展示匹配的文档片段和分数')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '检索' })).toBeDisabled()
  })

  it('hides the history button and dropdown when the selected base has no search history', () => {
    mockCache.initial = {
      'base-2': ['其他知识库查询']
    }

    render(<RecallTestPanel baseId="base-1" />)

    fireEvent.focus(screen.getByPlaceholderText('输入测试 Query...'))

    expect(screen.queryByRole('button', { name: '搜索历史' })).not.toBeInTheDocument()
    expect(screen.queryByText('搜索历史')).not.toBeInTheDocument()
    expect(screen.queryByText('其他知识库查询')).not.toBeInTheDocument()
  })

  it('shows cached search query history for the selected base when the search input receives focus', () => {
    render(<RecallTestPanel baseId="base-1" />)

    fireEvent.focus(screen.getByPlaceholderText('输入测试 Query...'))

    expect(screen.getByText('搜索历史')).toBeInTheDocument()
    expect(screen.getByText('RAG 检索增强生成原理')).toBeInTheDocument()
    expect(screen.getByText('向量数据库选型对比')).toBeInTheDocument()
    expect(screen.queryByText('其他知识库查询')).not.toBeInTheDocument()
  })

  it('keeps search history open when clicking the focused input again', () => {
    render(<RecallTestPanel baseId="base-1" />)

    const input = screen.getByPlaceholderText('输入测试 Query...')
    fireEvent.focus(input)
    fireEvent.click(input)

    expect(screen.getByText('搜索历史')).toBeInTheDocument()
    expect(screen.getByText('RAG 检索增强生成原理')).toBeInTheDocument()
    expect(mockKnowledgeRuntimeSearch).not.toHaveBeenCalled()
  })

  it('closes search history when input loses focus outside the history popover', async () => {
    render(<RecallTestPanel baseId="base-1" />)

    const input = screen.getByPlaceholderText('输入测试 Query...')
    fireEvent.focus(input)
    expect(screen.getByText('搜索历史')).toBeInTheDocument()

    fireEvent.blur(input, { relatedTarget: document.body })

    await waitFor(() => {
      expect(screen.queryByText('搜索历史')).not.toBeInTheDocument()
    })
  })

  it('fills the query from history and closes the history popover without searching', async () => {
    render(<RecallTestPanel baseId="base-1" />)

    const input = screen.getByPlaceholderText('输入测试 Query...')
    fireEvent.focus(input)
    fireEvent.click(screen.getByText('RAG 检索增强生成原理'))

    expect(input).toHaveValue('RAG 检索增强生成原理')

    await waitFor(() => {
      expect(screen.queryByText('搜索历史')).not.toBeInTheDocument()
    })
    expect(screen.queryByText('5 个结果')).not.toBeInTheDocument()
  })

  it('calls runtime IPC, logs the returned data, and renders real result cards after searching', async () => {
    mockKnowledgeRuntimeSearch.mockImplementation(async () => {
      mockPerformanceNow.mockReturnValue(223)
      return realSearchResults
    })

    render(<RecallTestPanel baseId="base-1" />)

    fireEvent.change(screen.getByPlaceholderText('输入测试 Query...'), {
      target: { value: 'RAG 检索增强生成原理' }
    })
    fireEvent.click(screen.getByRole('button', { name: '检索' }))

    await waitFor(() => {
      expect(mockKnowledgeRuntimeSearch).toHaveBeenCalledWith('base-1', 'RAG 检索增强生成原理')
    })
    expect(mockLogger.info).toHaveBeenCalledWith('Knowledge recall search IPC result', {
      baseId: 'base-1',
      query: 'RAG 检索增强生成原理',
      results: realSearchResults
    })
    expect(screen.getByText('2 个结果')).toBeInTheDocument()
    expect(screen.getByText('123ms')).toBeInTheDocument()
    expect(screen.getByText('最高: 76.00')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '复制片段' })).toHaveLength(2)
    expect(screen.getByText('真实文档.pdf')).toBeInTheDocument()
    expect(screen.getByText('路径文档.md')).toBeInTheDocument()
    expect(screen.getByText('#3')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByText('0.98')).toBeInTheDocument()
    expect(screen.getByText('76.00')).toBeInTheDocument()
    expect(screen.getByText('real result from file name')).toBeInTheDocument()
    expect(screen.getByText('real result from file path')).toBeInTheDocument()
    expect(screen.queryByText('RAG 技术指南.pdf')).not.toBeInTheDocument()
    expect(screen.queryByText('知识库最佳实践.md')).not.toBeInTheDocument()
  })

  it('shows a searching state while runtime IPC is pending', async () => {
    let resolveSearch: (value: typeof realSearchResults) => void = () => undefined
    mockKnowledgeRuntimeSearch.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve
      })
    )

    render(<RecallTestPanel baseId="base-1" />)

    fireEvent.change(screen.getByPlaceholderText('输入测试 Query...'), {
      target: { value: 'RAG 检索增强生成原理' }
    })
    fireEvent.click(screen.getByRole('button', { name: '检索' }))

    expect(screen.getByText('正在检索...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '检索' })).toBeDisabled()

    mockPerformanceNow.mockReturnValue(223)
    resolveSearch(realSearchResults)

    await waitFor(() => {
      expect(screen.queryByText('正在检索...')).not.toBeInTheDocument()
    })
    expect(screen.getByText('2 个结果')).toBeInTheDocument()
  })

  it('removes one cached query from the selected base history', () => {
    render(<RecallTestPanel baseId="base-1" />)

    fireEvent.focus(screen.getByPlaceholderText('输入测试 Query...'))
    fireEvent.click(screen.getAllByRole('button', { name: '删除历史' })[0])

    expect(mockCache.set).toHaveBeenCalledWith({
      'base-1': ['向量数据库选型对比'],
      'base-2': ['其他知识库查询']
    })
    expect(screen.queryByText('RAG 检索增强生成原理')).not.toBeInTheDocument()
    expect(screen.getByText('向量数据库选型对比')).toBeInTheDocument()
  })

  it('clears cached query history for the selected base only', () => {
    render(<RecallTestPanel baseId="base-1" />)

    fireEvent.focus(screen.getByPlaceholderText('输入测试 Query...'))
    fireEvent.click(screen.getByRole('button', { name: '清空' }))

    expect(mockCache.set).toHaveBeenCalledWith({
      'base-1': [],
      'base-2': ['其他知识库查询']
    })
    expect(screen.queryByText('搜索历史')).not.toBeInTheDocument()
    expect(screen.queryByText('RAG 检索增强生成原理')).not.toBeInTheDocument()
    expect(screen.queryByText('向量数据库选型对比')).not.toBeInTheDocument()
  })

  it('records submitted queries with dedupe and a five item limit', async () => {
    mockCache.initial = {
      'base-1': ['旧查询 1', 'RAG 检索增强生成原理', '旧查询 2', '旧查询 3', '旧查询 4'],
      'base-2': ['其他知识库查询']
    }

    render(<RecallTestPanel baseId="base-1" />)

    fireEvent.change(screen.getByPlaceholderText('输入测试 Query...'), {
      target: { value: '  RAG 检索增强生成原理  ' }
    })
    fireEvent.click(screen.getByRole('button', { name: '检索' }))

    expect(mockCache.set).toHaveBeenCalledWith({
      'base-1': ['RAG 检索增强生成原理', '旧查询 1', '旧查询 2', '旧查询 3', '旧查询 4'],
      'base-2': ['其他知识库查询']
    })

    await waitFor(() => {
      expect(screen.queryByText('正在检索...')).not.toBeInTheDocument()
    })
  })

  it('logs runtime IPC failures without throwing', async () => {
    const error = new Error('search failed')
    mockKnowledgeRuntimeSearch.mockRejectedValue(error)

    render(<RecallTestPanel baseId="base-1" />)

    fireEvent.change(screen.getByPlaceholderText('输入测试 Query...'), {
      target: { value: '  RAG 检索增强生成原理  ' }
    })
    fireEvent.click(screen.getByRole('button', { name: '检索' }))

    await waitFor(() => {
      expect(mockLogger.error).toHaveBeenCalledWith('Knowledge recall search IPC failed', error, {
        baseId: 'base-1',
        query: 'RAG 检索增强生成原理'
      })
    })
    expect(screen.getByText('0 个结果')).toBeInTheDocument()
    expect(screen.getByText('最高: 0.00')).toBeInTheDocument()
    expect(screen.queryByText('RAG 技术指南.pdf')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制片段' })).not.toBeInTheDocument()
  })
})
