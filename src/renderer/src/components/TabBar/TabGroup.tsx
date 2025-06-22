import { CaretRightOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useAppDispatch } from '@renderer/store'
import { deleteGroup, Tab, TabGroup as TabGroupType, toggleGroupCollapse, updateGroup } from '@renderer/store/tabs'
import { Input, Popover } from 'antd'
import { AnimatePresence, motion } from 'framer-motion'
import React, { useState } from 'react'
import styled from 'styled-components'

interface TabGroupProps {
  group: TabGroupType
  tabs: Tab[]
  children: React.ReactNode
  onAddTab: () => void
}

export const TabGroup: React.FC<TabGroupProps> = ({ group, tabs, children, onAddTab }) => {
  const dispatch = useAppDispatch()
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(group.name)
  const [showColorPicker, setShowColorPicker] = useState(false)

  const handleToggleCollapse = () => {
    dispatch(toggleGroupCollapse(group.id))
  }

  const handleRename = () => {
    if (editName.trim() && editName !== group.name) {
      dispatch(updateGroup({ id: group.id, updates: { name: editName.trim() } }))
    }
    setIsEditing(false)
  }

  const handleDelete = () => {
    // TODO: Add confirmation dialog
    dispatch(deleteGroup(group.id))
  }

  const handleColorChange = (color: string) => {
    dispatch(updateGroup({ id: group.id, updates: { color } }))
    setShowColorPicker(false)
  }

  const colorPalette = ['#E53E3E', '#DD6B20', '#D69E2E', '#38A169', '#3182CE', '#805AD5', '#D53F8C', '#718096']

  return (
    <GroupContainer>
      <GroupHeader color={group.color}>
        <GroupHeaderLeft onClick={handleToggleCollapse}>
          <CollapseIcon
            initial={{ rotate: group.isCollapsed ? 0 : 90 }}
            animate={{ rotate: group.isCollapsed ? 0 : 90 }}
            transition={{ duration: 0.2 }}>
            <CaretRightOutlined />
          </CollapseIcon>

          <Popover
            content={
              <ColorPicker>
                {colorPalette.map((color) => (
                  <ColorOption
                    key={color}
                    color={color}
                    isSelected={color === group.color}
                    onClick={() => handleColorChange(color)}
                  />
                ))}
              </ColorPicker>
            }
            open={showColorPicker}
            onOpenChange={setShowColorPicker}
            trigger="click">
            <ColorIndicator color={group.color} onClick={(e) => e.stopPropagation()} />
          </Popover>

          {isEditing ? (
            <Input
              size="small"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onPressEnter={handleRename}
              onBlur={handleRename}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              style={{ width: 120 }}
            />
          ) : (
            <GroupName>{group.name}</GroupName>
          )}

          <TabCount>({tabs.length})</TabCount>
        </GroupHeaderLeft>

        <GroupActions>
          <ActionButton
            onClick={(e) => {
              e.stopPropagation()
              setIsEditing(true)
            }}>
            <EditOutlined />
          </ActionButton>
          <ActionButton
            onClick={(e) => {
              e.stopPropagation()
              onAddTab()
            }}>
            <PlusOutlined />
          </ActionButton>
          <ActionButton
            onClick={(e) => {
              e.stopPropagation()
              handleDelete()
            }}>
            <DeleteOutlined />
          </ActionButton>
        </GroupActions>
      </GroupHeader>

      <AnimatePresence initial={false}>
        {!group.isCollapsed && (
          <TabsContainer
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}>
            <TabsContent>{children}</TabsContent>
          </TabsContainer>
        )}
      </AnimatePresence>
    </GroupContainer>
  )
}

const GroupContainer = styled.div`
  display: flex;
  align-items: center;
  position: relative;
  -webkit-app-region: no-drag;

  &:not(:last-child)::after {
    content: '';
    position: absolute;
    right: -4px;
    top: 50%;
    transform: translateY(-50%);
    width: 1px;
    height: 20px;
    background: var(--color-border);
    opacity: 0.5;
  }
`

const GroupHeader = styled.div<{ color: string }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--color-background-soft);
  border-left: 3px solid ${({ color }) => color};
  cursor: pointer;
  user-select: none;
  -webkit-app-region: no-drag;

  &:hover {
    background: var(--color-background-hover);
  }
`

const GroupHeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
`

const CollapseIcon = styled(motion.div)`
  display: flex;
  align-items: center;
  color: var(--color-text-secondary);
`

const ColorIndicator = styled.div<{ color: string }>`
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: ${({ color }) => color};
  cursor: pointer;

  &:hover {
    transform: scale(1.1);
  }
`

const GroupName = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
`

const TabCount = styled.span`
  font-size: 12px;
  color: var(--color-text-secondary);
`

const GroupActions = styled.div`
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;

  ${GroupHeader}:hover & {
    opacity: 1;
  }
`

const ActionButton = styled.button`
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;

  &:hover {
    background: var(--color-background);
    color: var(--color-text-primary);
  }
`

const TabsContainer = styled(motion.div)`
  overflow: hidden;
`

const TabsContent = styled.div`
  padding: 4px 0;
`

const ColorPicker = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 8px;
`

const ColorOption = styled.div<{ color: string; isSelected: boolean }>`
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: ${({ color }) => color};
  cursor: pointer;
  position: relative;

  ${({ isSelected }) =>
    isSelected &&
    `
    &::after {
      content: '✓';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      font-size: 12px;
    }
  `}

  &:hover {
    transform: scale(1.1);
  }
`
