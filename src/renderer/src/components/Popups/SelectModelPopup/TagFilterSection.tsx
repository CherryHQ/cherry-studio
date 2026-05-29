import { Flex } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import {
  EmbeddingTag,
  FreeTag,
  ReasoningTag,
  RerankerTag,
  ToolsCallingTag,
  VisionTag,
  WebSearchTag
} from '@renderer/components/Tags/Model'
import type { ModelTag } from '@renderer/types'
import React, { startTransition, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('TagFilterSection')

interface TagFilterSectionProps {
  availableTags: ModelTag[]
  tagSelection: Record<ModelTag, boolean>
  onToggleTag: (tag: ModelTag) => void
}

const TagFilterSection: React.FC<TagFilterSectionProps> = ({ availableTags, tagSelection, onToggleTag }) => {
  const { t } = useTranslation()

  const handleTagClick = useCallback(
    (tag: ModelTag) => {
      startTransition(() => onToggleTag(tag))
    },
    [onToggleTag]
  )

  // 标签组件
  const tagComponents = useMemo(
    () => ({
      vision: VisionTag,
      embedding: EmbeddingTag,
      reasoning: ReasoningTag,
      function_calling: ToolsCallingTag,
      web_search: WebSearchTag,
      rerank: RerankerTag,
      free: FreeTag
    }),
    []
  )

  return (
    <div className="py-2 pr-2 pl-[18px]">
      <Flex className="flex-wrap gap-1">
        <span className="text-foreground-muted text-xs">{t('models.filter.by_tag')}</span>
        {availableTags.map((tag) => {
          const TagElement = tagComponents[tag]
          if (!TagElement) {
            logger.error(`Tag element not found for tag: ${tag}`)
            return null
          }
          return (
            <TagElement
              key={`tag-${tag}`}
              onClick={() => handleTagClick(tag)}
              inactive={!tagSelection[tag]}
              showLabel
            />
          )
        })}
      </Flex>
    </div>
  )
}

export default TagFilterSection
