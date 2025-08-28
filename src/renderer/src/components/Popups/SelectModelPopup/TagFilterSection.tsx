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
import React, { ReactNode, startTransition, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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

  // 筛选项列表
  const tagsItems: Record<ModelTag, ReactNode> = useMemo(
    () => ({
      vision: <VisionTag showLabel inactive={!tagSelection.vision} onClick={() => handleTagClick('vision')} />,
      embedding: <EmbeddingTag inactive={!tagSelection.embedding} onClick={() => handleTagClick('embedding')} />,
      reasoning: (
        <ReasoningTag showLabel inactive={!tagSelection.reasoning} onClick={() => handleTagClick('reasoning')} />
      ),
      function_calling: (
        <ToolsCallingTag
          showLabel
          inactive={!tagSelection.function_calling}
          onClick={() => handleTagClick('function_calling')}
        />
      ),
      web_search: (
        <WebSearchTag showLabel inactive={!tagSelection.web_search} onClick={() => handleTagClick('web_search')} />
      ),
      rerank: <RerankerTag inactive={!tagSelection.rerank} onClick={() => handleTagClick('rerank')} />,
      free: <FreeTag inactive={!tagSelection.free} onClick={() => handleTagClick('free')} />
    }),
    [
      handleTagClick,
      tagSelection.embedding,
      tagSelection.free,
      tagSelection.function_calling,
      tagSelection.reasoning,
      tagSelection.rerank,
      tagSelection.vision,
      tagSelection.web_search
    ]
  )

  // 要显示的筛选项
  const displayedTags = useMemo(() => availableTags.map((tag) => tagsItems[tag]), [availableTags, tagsItems])

  return (
    <FilterContainer>
      <Flex wrap="wrap" gap={4}>
        <FilterText>{t('models.filter.by_tag')}</FilterText>
        {displayedTags.map((item) => item)}
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
