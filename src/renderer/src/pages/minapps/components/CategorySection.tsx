import App from '@renderer/components/MinApp/MinApp'
import type { RootState } from '@renderer/store'
import { useAppSelector } from '@renderer/store'
import type { MinAppType } from '@renderer/types'
import React, { FC, useState } from 'react'
import styled from 'styled-components'

type CategoryId = 'pinned' | 'enabled' | 'disabled'

type CategorySectionProps = {
  id: CategoryId
  title: string
  apps: MinAppType[]
  onDrop?: (e: React.DragEvent, target: CategoryId) => void
}

const CategorySection: FC<CategorySectionProps> = ({ id, title, apps, onDrop }) => {
  const iconOnly = useAppSelector((state: RootState) => state.minapps.iconOnly)
  const [isDragOver, setIsDragOver] = useState(false)

  return (
    <SectionContainer
      id={`minapps-section-${id}`}
      $isDragOver={isDragOver}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragOver(false)
        onDrop?.(e, id)
      }}>
      <SectionHeader>{title}</SectionHeader>
      <AppsGrid $iconOnly={iconOnly}>
        {apps.map((app) => (
          <DraggableWrapper
            key={app.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', app.id)
              e.dataTransfer.effectAllowed = 'move'
            }}>
            <App app={app} />
          </DraggableWrapper>
        ))}
      </AppsGrid>
    </SectionContainer>
  )
}

const SectionContainer = styled.div<{ $isDragOver: boolean }>`
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: 8px;
  padding: 12px;
  transition: background-color 0.2s;
  background-color: ${({ $isDragOver }) => ($isDragOver ? 'var(--color-bg-2, rgba(0, 0, 0, 0.04))' : 'transparent')};
  outline: 1px dashed ${({ $isDragOver }) => ($isDragOver ? 'var(--color-primary)' : 'transparent')};
  outline-offset: -4px;
`

const SectionHeader = styled.div`
  font-weight: 600;
  font-size: 13px;
  color: var(--color-text-soft);
  margin-bottom: 12px;
  margin-left: 4px;
`

const AppsGrid = styled.div<{ $iconOnly: boolean }>`
  display: grid;
  grid-template-columns: repeat(auto-fill, ${({ $iconOnly }) => ($iconOnly ? '60px' : '90px')});
  gap: ${({ $iconOnly }) => ($iconOnly ? '15px' : '25px')};
  justify-content: start;
`

const DraggableWrapper = styled.div`
  display: inline-block;
  cursor: grab;
  user-select: none;

  &:active {
    cursor: grabbing;
  }
`

export default CategorySection
