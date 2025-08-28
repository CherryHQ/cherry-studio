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
import { ModelTag } from '@renderer/types'
import { Flex } from 'antd'
import React, { startTransition, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
    <FilterContainer>
      <Flex wrap="wrap" gap={4}>
        <FilterText>{t('models.filter.by_tag')}</FilterText>
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
    </FilterContainer>
  )
}

const FilterContainer = styled.div`
  padding: 8px;
  padding-left: 18px;
`

const FilterText = styled.span`
  color: var(--color-text-3);
  font-size: 12px;
`

export default TagFilterSection
