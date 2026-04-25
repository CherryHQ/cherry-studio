import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import KnowledgeItemChunkDetailPanel, { mockKnowledgeItemChunks } from '../KnowledgeItemChunkDetailPanel'
import { createFileItem } from './testUtils'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  )
}))

vi.mock('@renderer/pages/knowledge.v2/utils', () => ({
  formatRelativeTime: () => '刚刚'
}))

vi.mock('@renderer/utils', () => ({
  formatFileSize: () => '2.4 MB'
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined
  },
  useTranslation: () => ({
    i18n: {
      language: 'zh-CN'
    },
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'knowledge_v2.data_source.chunks_count') {
        return `${options?.count} chunks`
      }

      return (
        (
          {
            'common.back': '返回',
            'common.delete': '删除',
            'common.edit': '编辑',
            'common.expand': '展开',
            'knowledge_v2.data_source.filters.file': '文件',
            'knowledge_v2.rag.tokens_unit': 'tokens',
            'knowledge_v2.data_source.status.ready': '就绪'
          } as Record<string, string>
        )[key] ?? key
      )
    }
  })
}))

describe('KnowledgeItemChunkDetailPanel', () => {
  it('renders item metadata and mock chunks', () => {
    render(
      <KnowledgeItemChunkDetailPanel
        item={createFileItem({ id: 'file-1', originName: 'RAG 技术指南.pdf', ext: 'PDF', size: 2516582 })}
        onBack={() => undefined}
      />
    )

    expect(screen.getByText('RAG 技术指南.pdf')).toBeInTheDocument()
    expect(screen.getByText('pdf')).toBeInTheDocument()
    expect(screen.getByText('2.4 MB')).toBeInTheDocument()
    expect(screen.getByText(`${mockKnowledgeItemChunks.length} chunks`)).toBeInTheDocument()
    expect(screen.getByText('145 tokens')).toBeInTheDocument()
    expect(screen.getByText(/RAG（检索增强生成）是一种将信息检索与生成式 AI 模型相结合的技术/)).toBeInTheDocument()
  })

  it('renders placeholder chunk action buttons with zh-CN labels', () => {
    render(
      <KnowledgeItemChunkDetailPanel
        item={createFileItem({ id: 'file-1', originName: 'RAG 技术指南.pdf' })}
        onBack={() => undefined}
      />
    )

    expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(mockKnowledgeItemChunks.length)
    expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(mockKnowledgeItemChunks.length)
    expect(screen.getAllByRole('button', { name: '展开' })).toHaveLength(mockKnowledgeItemChunks.length)
  })

  it('calls onBack from the header back button', () => {
    const onBack = vi.fn()

    render(
      <KnowledgeItemChunkDetailPanel
        item={createFileItem({ id: 'file-1', originName: 'RAG 技术指南.pdf' })}
        onBack={onBack}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '返回' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
