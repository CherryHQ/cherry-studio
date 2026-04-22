import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import KnowledgeItemRow from '../KnowledgeItemRow'
import { createFileItem, createUrlItem } from './testUtils'

vi.mock('@renderer/pages/knowledge.v2/utils', () => ({
  formatRelativeTime: () => '刚刚'
}))

vi.mock('@renderer/utils', () => ({
  formatFileSize: () => '1 KB'
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'zh-CN'
    },
    t: (key: string) =>
      (
        ({
          'knowledge_v2.data_source.status.ready': '就绪',
          'knowledge_v2.data_source.status.error': '失败',
          'knowledge_v2.data_source.status.embedding': '向量化中',
          'knowledge_v2.data_source.status.chunking': '分块中',
          'knowledge_v2.rag.file_processing': '文件处理',
          'knowledge.status_pending': '等待中'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

describe('KnowledgeItemRow', () => {
  it('renders the file suffix and meta parts from the row view model', () => {
    render(
      <KnowledgeItemRow
        item={createFileItem({ id: 'file-1', originName: '季度报告.pdf', ext: 'PDF' })}
        onClick={() => undefined}
      />
    )

    expect(screen.getByText('季度报告.pdf')).toBeInTheDocument()
    expect(screen.getByText('pdf')).toBeInTheDocument()
    expect(screen.getByText('1 KB')).toBeInTheDocument()
    expect(screen.getByText('刚刚')).toBeInTheDocument()
  })

  it('renders the completed status label for ready items', () => {
    render(<KnowledgeItemRow item={createFileItem({ id: 'file-1', status: 'completed' })} onClick={() => undefined} />)

    expect(screen.getByText('就绪')).toBeInTheDocument()
  })

  it('renders the failed status label for failed items', () => {
    render(<KnowledgeItemRow item={createFileItem({ id: 'file-1', status: 'failed' })} onClick={() => undefined} />)

    expect(screen.getByText('失败')).toBeInTheDocument()
  })

  it('renders the processing status label for in-flight items', () => {
    render(
      <KnowledgeItemRow item={createFileItem({ id: 'file-1', status: 'file_processing' })} onClick={() => undefined} />
    )

    expect(screen.getByText('文件处理')).toBeInTheDocument()
  })

  it('calls onClick when the row is clicked', () => {
    const handleClick = vi.fn()

    render(<KnowledgeItemRow item={createUrlItem({ id: 'url-1', name: '产品文档' })} onClick={handleClick} />)

    fireEvent.click(screen.getByText('产品文档'))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
