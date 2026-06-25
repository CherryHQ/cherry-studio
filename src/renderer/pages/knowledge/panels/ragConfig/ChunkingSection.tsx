import { Switch } from '@cherrystudio/ui'
import { DEFAULT_KNOWLEDGE_CHUNK_SEPARATOR, type KnowledgeChunkStrategy } from '@shared/data/types/knowledge'
import { useTranslation } from 'react-i18next'

import type { KnowledgeRagChunkValidationErrorCode } from '../../utils'
import { RagFieldRow, RagHintText, RagInlineField } from './panelPrimitives'

interface ChunkingSectionProps {
  chunkStrategy: KnowledgeChunkStrategy
  chunkSeparator: string
  chunkSize: string
  chunkOverlap: string
  chunkSizeErrorCode?: KnowledgeRagChunkValidationErrorCode
  chunkOverlapErrorCode?: KnowledgeRagChunkValidationErrorCode
  chunkSeparatorErrorCode?: KnowledgeRagChunkValidationErrorCode
  onChunkStrategyChange: (value: KnowledgeChunkStrategy) => void
  onChunkSeparatorChange: (value: string) => void
  onChunkSizeChange: (value: string) => void
  onChunkOverlapChange: (value: string) => void
}

const ChunkingSection = ({
  chunkStrategy,
  chunkSeparator,
  chunkSize,
  chunkOverlap,
  chunkSizeErrorCode,
  chunkOverlapErrorCode,
  chunkSeparatorErrorCode,
  onChunkStrategyChange,
  onChunkSeparatorChange,
  onChunkSizeChange,
  onChunkOverlapChange
}: ChunkingSectionProps) => {
  const { t } = useTranslation()
  const getValidationErrorMessage = (errorCode?: KnowledgeRagChunkValidationErrorCode) => {
    switch (errorCode) {
      case 'chunkSizeInvalid':
        return t('knowledge.rag.chunk_size_invalid')
      case 'chunkOverlapInvalid':
        return t('knowledge.rag.chunk_overlap_invalid')
      case 'chunkOverlapMustBeSmaller':
        return t('knowledge.rag.chunk_overlap_must_be_smaller')
      case 'chunkSeparatorRequired':
        return t('knowledge.rag.chunk_separator_required')
      default:
        return undefined
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-4">
        <RagFieldRow label={t('knowledge.rag.smart_chunking')} hint={t('knowledge.rag.hints.smart_chunking')}>
          <Switch
            checked={chunkStrategy === 'structured'}
            onCheckedChange={(checked) => onChunkStrategyChange(checked ? 'structured' : 'delimiter')}
          />
        </RagFieldRow>
        <RagInlineField
          label={t('knowledge.rag.chunk_separator')}
          hint={t('knowledge.rag.hints.chunk_separator')}
          value={chunkSeparator}
          placeholder={DEFAULT_KNOWLEDGE_CHUNK_SEPARATOR}
          onChange={onChunkSeparatorChange}
        />
        <RagInlineField
          label={t('knowledge.rag.chunk_size')}
          hint={t('knowledge.rag.hints.chunk_size')}
          value={chunkSize}
          suffix={t('knowledge.rag.tokens_unit')}
          inputMode="numeric"
          onChange={onChunkSizeChange}
        />
        <RagInlineField
          label={t('knowledge.rag.chunk_overlap')}
          hint={t('knowledge.rag.hints.chunk_overlap')}
          value={chunkOverlap}
          suffix={t('knowledge.rag.tokens_unit')}
          inputMode="numeric"
          onChange={onChunkOverlapChange}
        />
      </div>

      {chunkSizeErrorCode ? (
        <RagHintText tone="error">{getValidationErrorMessage(chunkSizeErrorCode)}</RagHintText>
      ) : null}
      {chunkOverlapErrorCode ? (
        <RagHintText tone="error">{getValidationErrorMessage(chunkOverlapErrorCode)}</RagHintText>
      ) : null}
      {chunkSeparatorErrorCode ? (
        <RagHintText tone="error">{getValidationErrorMessage(chunkSeparatorErrorCode)}</RagHintText>
      ) : null}
      <RagHintText tone="warning">{t('knowledge.rag.chunk_size_change_warning')}</RagHintText>
    </div>
  )
}

export default ChunkingSection
