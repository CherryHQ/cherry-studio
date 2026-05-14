import { Button, WarnTooltip } from '@cherrystudio/ui'
import {
  EmbeddingTag,
  ReasoningTag,
  RerankerTag,
  ToolsCallingTag,
  VisionTag,
  WebSearchTag
} from '@renderer/components/Tags/Model'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ModelCapabilityToggle } from './types'

interface ModelCapabilityTogglesProps {
  selectedCaps: Set<ModelCapabilityToggle>
  hasUserModified: boolean
  onToggle: (type: ModelCapabilityToggle) => void
  onReset: () => void
}

export function ModelCapabilityToggles({
  selectedCaps,
  hasUserModified,
  onToggle,
  onReset
}: ModelCapabilityTogglesProps) {
  const { t } = useTranslation()
  const isRerankDisabled = selectedCaps.has(MODEL_CAPABILITY.EMBEDDING)
  const isEmbeddingDisabled = selectedCaps.has(MODEL_CAPABILITY.RERANK)
  const isOtherDisabled = selectedCaps.has(MODEL_CAPABILITY.RERANK) || selectedCaps.has(MODEL_CAPABILITY.EMBEDDING)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 font-[weight:var(--font-weight-semibold)] text-[length:var(--font-size-body-md)] text-foreground/90 leading-[var(--line-height-body-md)]">
          {t('models.type.select')}
          <WarnTooltip content={t('settings.moresetting.check.warn')} />
        </div>
        {hasUserModified && (
          <Button variant="ghost" size="icon-sm" onClick={onReset}>
            <RotateCcw size={14} />
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <VisionTag
          showLabel
          inactive={isOtherDisabled || !selectedCaps.has(MODEL_CAPABILITY.IMAGE_RECOGNITION)}
          disabled={isOtherDisabled}
          onClick={() => onToggle(MODEL_CAPABILITY.IMAGE_RECOGNITION)}
        />
        <WebSearchTag
          showLabel
          inactive={isOtherDisabled || !selectedCaps.has(MODEL_CAPABILITY.WEB_SEARCH)}
          disabled={isOtherDisabled}
          onClick={() => onToggle(MODEL_CAPABILITY.WEB_SEARCH)}
        />
        <ReasoningTag
          showLabel
          inactive={isOtherDisabled || !selectedCaps.has(MODEL_CAPABILITY.REASONING)}
          disabled={isOtherDisabled}
          onClick={() => onToggle(MODEL_CAPABILITY.REASONING)}
        />
        <ToolsCallingTag
          showLabel
          inactive={isOtherDisabled || !selectedCaps.has(MODEL_CAPABILITY.FUNCTION_CALL)}
          disabled={isOtherDisabled}
          onClick={() => onToggle(MODEL_CAPABILITY.FUNCTION_CALL)}
        />
        <RerankerTag
          disabled={isRerankDisabled}
          inactive={isRerankDisabled || !selectedCaps.has(MODEL_CAPABILITY.RERANK)}
          onClick={() => onToggle(MODEL_CAPABILITY.RERANK)}
        />
        <EmbeddingTag
          disabled={isEmbeddingDisabled}
          inactive={isEmbeddingDisabled || !selectedCaps.has(MODEL_CAPABILITY.EMBEDDING)}
          onClick={() => onToggle(MODEL_CAPABILITY.EMBEDDING)}
        />
      </div>
    </div>
  )
}
