import CustomTag from '@renderer/components/Tags/CustomTag'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { FC, useRef, useState } from 'react'
import styled from 'styled-components'

const MentionModelsInput: FC<{
  selectedModels: Model[]
  onRemoveModel: (model: Model) => void
  isInputExpanded?: boolean
}> = ({ selectedModels, onRemoveModel, isInputExpanded = false }) => {
  const { providers } = useProviders()
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  const getProviderName = (model: Model) => {
    const provider = providers.find((p) => p.id === model?.provider)
    return provider ? getFancyProviderName(provider) : ''
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isInputExpanded) return

    setIsDragging(true)
    setStartX(e.clientX)
    if (scrollContainerRef.current) {
      setScrollLeft(scrollContainerRef.current.scrollLeft)
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return
    const dx = e.clientX - startX
    scrollContainerRef.current.scrollLeft = scrollLeft - dx
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  return (
    <Container>
      <ScrollContainer
        ref={scrollContainerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        $isExpanded={isInputExpanded}>
        {selectedModels.map((model) => (
          <CustomTag
            icon={<i className="iconfont icon-at" />}
            color="#1677ff"
            key={getModelUniqId(model)}
            closable
            onClose={() => onRemoveModel(model)}>
            {model.name} ({getProviderName(model)})
          </CustomTag>
        ))}
      </ScrollContainer>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  padding: 5px 15px 5px 15px;
  position: relative;
`

const ScrollContainer = styled.div<{ $isExpanded: boolean }>`
  display: flex;
  flex-wrap: ${(props) => (props.$isExpanded ? 'wrap' : 'nowrap')};
  gap: 4px;
  overflow-x: ${(props) => (props.$isExpanded ? 'hidden' : 'auto')};
  overflow-y: auto;
  max-height: ${(props) => (props.$isExpanded ? '150px' : 'auto')};
  scrollbar-width: none;
  cursor: ${(props) => (props.$isExpanded ? 'default' : 'grab')};
  &:active {
    cursor: ${(props) => (props.$isExpanded ? 'default' : 'grabbing')};
  }

  /* 显示垂直滚动条，仅在展开状态 */
  &::-webkit-scrollbar {
    width: ${(props) => (props.$isExpanded ? '3px' : '0')};
    height: 0;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
  }
`

export default MentionModelsInput
