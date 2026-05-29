import { Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { KnowledgeRagChunkValidationErrorCode } from '../../utils'
import { RagHintText, RagNumericField, RagSectionTitle } from './panelPrimitives'

interface ChunkingSectionProps {
  chunkSize: string
  chunkOverlap: string
  chunkSizeErrorCode?: KnowledgeRagChunkValidationErrorCode
  chunkOverlapErrorCode?: KnowledgeRagChunkValidationErrorCode
  onChunkSizeChange: (value: string) => void
  onChunkOverlapChange: (value: string) => void
}

const ChunkingSection = ({
  chunkSize,
  chunkOverlap,
  chunkSizeErrorCode,
  chunkOverlapErrorCode,
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
      default:
        return undefined
    }
  }

  return (
    <section className="space-y-2.5">
      <RagSectionTitle title={t('knowledge.rag.chunking')} icon={Layers} />

      <div className="grid grid-cols-2 gap-2">
        <RagNumericField
          label={t('knowledge.rag.chunk_size')}
          hint={t('knowledge.rag.hints.chunk_size')}
          value={chunkSize}
          suffix={t('knowledge.rag.tokens_unit')}
          onChange={onChunkSizeChange}
        />
        <RagNumericField
          label={t('knowledge.rag.chunk_overlap')}
          hint={t('knowledge.rag.hints.chunk_overlap')}
          value={chunkOverlap}
          suffix={t('knowledge.rag.tokens_unit')}
          onChange={onChunkOverlapChange}
        />
      </div>

      {chunkSizeErrorCode ? (
        <RagHintText tone="error">{getValidationErrorMessage(chunkSizeErrorCode)}</RagHintText>
      ) : null}
      {chunkOverlapErrorCode ? (
        <RagHintText tone="error">{getValidationErrorMessage(chunkOverlapErrorCode)}</RagHintText>
      ) : null}
      <RagHintText tone="warning">{t('knowledge.rag.chunk_size_change_warning')}</RagHintText>
    </section>
  )
}

export default ChunkingSection
