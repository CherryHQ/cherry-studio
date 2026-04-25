import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { formatFileSize } from '@renderer/utils'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { ArrowLeft, ChevronDown, Pencil, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { toKnowledgeItemRowViewModel } from './utils/selectors'

interface KnowledgeItemChunkDetailPanelProps {
  item: KnowledgeItem
  onBack: () => void
}

interface MockKnowledgeItemChunk {
  index: number
  tokens: number
  content: string
}

const mockKnowledgeItemChunks: MockKnowledgeItemChunk[] = [
  {
    index: 0,
    tokens: 145,
    content:
      'RAG（检索增强生成）是一种将信息检索与生成式 AI 模型相结合的技术。它通过从外部知识库中检索相关文档，并将检索到的内容作为上下文传递给大语言模型。'
  },
  {
    index: 1,
    tokens: 180,
    content:
      '在实际应用中，RAG 系统通常包含文档加载、文本分块、向量化、索引存储、查询检索和答案生成几个阶段。每个阶段都会影响最终回答的准确性与可解释性。'
  },
  {
    index: 2,
    tokens: 132,
    content:
      '文档分块需要在语义完整性和检索粒度之间取得平衡。分块过大会引入噪声，分块过小则可能丢失上下文，通常需要结合文档类型和模型窗口进行调整。'
  },
  {
    index: 3,
    tokens: 156,
    content:
      'Embedding 模型会将文本转换为高维向量，使语义相近的内容在向量空间中距离更近。检索时，系统会比较查询向量和文档向量之间的相似度。'
  },
  {
    index: 4,
    tokens: 124,
    content:
      '向量数据库负责保存文档片段及其向量表示，并提供高效的近似最近邻搜索能力。常见索引结构包括 HNSW、IVF 和 Flat 等。'
  },
  {
    index: 5,
    tokens: 168,
    content:
      '召回阶段的目标是尽可能找到与用户问题相关的候选片段。召回数量过少可能漏掉关键证据，召回数量过多则会增加后续排序和上下文拼接成本。'
  },
  {
    index: 6,
    tokens: 142,
    content:
      'Rerank 模型会在初步检索结果上进行精排，重新评估查询与片段之间的匹配程度。它通常比单纯向量相似度更适合处理复杂问题。'
  },
  {
    index: 7,
    tokens: 118,
    content:
      '混合检索结合语义检索和关键词检索的优势，可以同时覆盖同义表达和精确术语匹配，适用于技术文档、法规条文和产品知识库。'
  },
  {
    index: 8,
    tokens: 150,
    content:
      '上下文拼接时需要保留来源、标题、页码或段落序号等元信息，方便模型引用证据，也方便用户在结果中追溯答案来源。'
  },
  {
    index: 9,
    tokens: 110,
    content:
      '向量检索的核心原理是将文本通过 Embedding 模型转换为高维向量，然后计算查询向量与文档向量之间的相似性，返回最相关的文档片段。'
  },
  {
    index: 10,
    tokens: 110,
    content:
      '混合检索策略结合了语义检索和关键词检索（BM25）的优势。两者结合可以显著提升检索召回率和准确率，适用于大多数实际场景。'
  },
  {
    index: 11,
    tokens: 165,
    content:
      'Rerank 模型在初步检索完成后对结果进行精排，能够更精确地评估查询与文档片段之间的相关性，有效提升 Top-K 结果的质量。'
  }
]

const getKnowledgeItemSizeMeta = (item: KnowledgeItem) => {
  if (item.type === 'file') {
    return formatFileSize(item.data.file.size)
  }

  return undefined
}

const KnowledgeItemChunkActionButton = ({
  label,
  className,
  children
}: {
  label: string
  className?: string
  children: ReactNode
}) => {
  const stopPlaceholderAction = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }

  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      className={cn(
        'size-4 min-h-4 rounded p-0 text-muted-foreground/25 shadow-none transition-colors hover:bg-accent hover:text-foreground',
        className
      )}
      onClick={stopPlaceholderAction}>
      {children}
    </Button>
  )
}

const KnowledgeItemChunkCard = ({ chunk }: { chunk: MockKnowledgeItemChunk }) => {
  const { t } = useTranslation()

  return (
    <div className="group/ck rounded-lg border border-border/20 transition-all hover:border-border/40">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span className="flex size-4 shrink-0 items-center justify-center rounded bg-accent/50 text-[0.5rem] text-muted-foreground/40 leading-3">
          {chunk.index}
        </span>
        <span className="flex-1 text-[0.5625rem] text-muted-foreground/30 leading-3.375">
          {chunk.tokens} {t('knowledge_v2.rag.tokens_unit')}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 transition-all group-hover/ck:opacity-100">
          <KnowledgeItemChunkActionButton label={t('common.edit')}>
            <Pencil className="size-2" />
          </KnowledgeItemChunkActionButton>
          <KnowledgeItemChunkActionButton label={t('common.delete')} className="hover:bg-red-500/10 hover:text-red-500">
            <Trash2 className="size-2" />
          </KnowledgeItemChunkActionButton>
          <KnowledgeItemChunkActionButton label={t('common.expand')}>
            <ChevronDown className="size-2.25" />
          </KnowledgeItemChunkActionButton>
        </div>
      </div>
      <div className="px-2.5 pb-2">
        <p className="line-clamp-2 text-[0.6875rem] text-foreground/70 leading-relaxed">{chunk.content}</p>
      </div>
    </div>
  )
}

const KnowledgeItemChunkDetailPanel = ({ item, onBack }: KnowledgeItemChunkDetailPanelProps) => {
  const {
    t,
    i18n: { language }
  } = useTranslation()
  const { icon, suffix, title } = toKnowledgeItemRowViewModel(item, language)
  const Icon = icon.icon
  const sizeMeta = getKnowledgeItemSizeMeta(item)
  const typeMeta = suffix || t(`knowledge_v2.data_source.filters.${item.type}`)
  const chunksCountMeta = t('knowledge_v2.data_source.chunks_count', { count: mockKnowledgeItemChunks.length })
  const metaParts = [typeMeta, sizeMeta, chunksCountMeta].filter((part): part is string => Boolean(part))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-border/15 border-b px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.back')}
          className="size-5 min-h-5 min-w-5 rounded p-0 text-muted-foreground/50 shadow-none transition-colors hover:bg-accent hover:text-foreground"
          onClick={onBack}>
          <ArrowLeft className="size-2.75" />
        </Button>
        <div
          className={cn('flex size-5 shrink-0 items-center justify-center rounded bg-accent/50', icon.iconClassName)}>
          <Icon className="size-2.5" strokeWidth={1.6} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[0.6875rem] text-foreground leading-4.125">{title}</span>
          <div className="flex items-center gap-2 text-[0.5625rem] text-muted-foreground/35 leading-3.375">
            {metaParts.map((part) => (
              <span key={part} className={part === typeMeta && suffix ? 'uppercase' : undefined}>
                {part}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2 [scrollbar-color:hsl(var(--border)/0.3)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
        {mockKnowledgeItemChunks.map((chunk) => (
          <KnowledgeItemChunkCard key={chunk.index} chunk={chunk} />
        ))}
      </div>
    </div>
  )
}

export { mockKnowledgeItemChunks }
export default KnowledgeItemChunkDetailPanel
