import { DownOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons'
import { Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import DragableList from '@renderer/components/DragableList'
import AddAssistantPopup from '@renderer/components/Popups/AddAssistantPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useChat } from '@renderer/hooks/useChat'
import { useAssistantsTabSortType } from '@renderer/hooks/useStore'
import { useTags } from '@renderer/hooks/useTags'
import { Assistant, AssistantsSortType } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { includeKeywords } from '@renderer/utils/search'
import { Tooltip } from 'antd'
import { FC, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AssistantItem from './components/AssistantItem'

interface AssistantsTabProps {
  searchValue?: string
}

const Assistants: FC<AssistantsTabProps> = ({ searchValue }) => {
  const { activeAssistant, setActiveAssistant } = useChat()
  const { assistants, removeAssistant, addAssistant, updateAssistants } = useAssistants()
  const [dragging, setDragging] = useState(false)
  const [collapsedTags, setCollapsedTags] = useState<Record<string, boolean>>({})
  const { t } = useTranslation()
  const { getGroupedAssistants, allTags, updateTagsOrder } = useTags()
  const { assistantsTabSortType = 'list', setAssistantsTabSortType } = useAssistantsTabSortType()
  const containerRef = useRef<HTMLDivElement>(null)
  const { defaultAssistant } = useDefaultAssistant()

  // 过滤助手 - 根据名称搜索
  const filteredAssistants = useMemo(() => {
    if (!searchValue?.trim()) {
      return assistants
    }
    return assistants.filter((assistant) => includeKeywords(assistant.name || '', searchValue))
  }, [assistants, searchValue])

  // 过滤分组助手 - 根据名称搜索
  const filteredGroupedAssistants = useMemo(() => {
    if (!searchValue?.trim()) {
      return getGroupedAssistants
    }
    return getGroupedAssistants
      .map((group) => ({
        ...group,
        assistants: group.assistants.filter((assistant) => includeKeywords(assistant.name || '', searchValue))
      }))
      .filter((group) => group.assistants.length > 0)
  }, [getGroupedAssistants, searchValue])

  const onCreateAssistant = async () => {
    const assistant = await AddAssistantPopup.show()
    assistant && setActiveAssistant(assistant)
  }

  const onCreateDefaultAssistant = useCallback(() => {
    const assistant = { ...defaultAssistant, id: uuid() }
    addAssistant(assistant)
    setActiveAssistant(assistant)
  }, [addAssistant, defaultAssistant, setActiveAssistant])

  const onDelete = useCallback(
    (assistant: Assistant) => {
      const remaining = assistants.filter((a) => a.id !== assistant.id)
      if (assistant.id === activeAssistant?.id) {
        const newActive = remaining[remaining.length - 1]
        newActive ? setActiveAssistant(newActive) : onCreateDefaultAssistant()
      }
      removeAssistant(assistant.id)
    },
    [activeAssistant, assistants, removeAssistant, setActiveAssistant, onCreateDefaultAssistant]
  )

  const toggleTagCollapse = useCallback((tag: string) => {
    setCollapsedTags((prev) => ({
      ...prev,
      [tag]: !prev[tag]
    }))
  }, [])

  const handleSortByChange = useCallback(
    (sortType: AssistantsSortType) => {
      setAssistantsTabSortType(sortType)
    },
    [setAssistantsTabSortType]
  )
  // 修改tag的方式得调整
  // 多条修改 同时修改assistants的tag
  const handleGroupReorder = useCallback(
    (newGroupList: { tag: string; newGroup: Assistant[] }[], _assistants: Assistant[]) => {
      const insertIndexMap = {}

      newGroupList.map((_) => {
        insertIndexMap[_.tag] = 0
      })

      const newGlobal = _assistants.map((a) => {
        const tag = (a.tags?.length ? a.tags : [t('assistants.tags.untagged')])[0]
        for (const group of newGroupList) {
          if (group.tag === tag) {
            const replaced = group.newGroup[insertIndexMap[tag]]
            insertIndexMap[tag] += 1
            return replaced
          }
        }
        return a
      })
      updateAssistants(newGlobal)
    },
    [t, updateAssistants]
  )

  const handleGroupDragEnd = useCallback(
    (result: DropResult) => {
      const { type, source, destination } = result
      if (!destination) return // 没有目标视作放弃移动 或者后续可以改成删除？
      if (type === 'ASSISTANT') {
        const sourceTag = source.droppableId
        const destTag = destination?.droppableId
        if (sourceTag !== destTag) {
          // 组件移动的时候要修改tag再移动
          // 移动到不同组
          const sourceGroup = getGroupedAssistants.find((g) => g.id === sourceTag)
          const sourceGroupAssistants = [...sourceGroup!.assistants]
          const destGroup = getGroupedAssistants.find((g) => g.id === destTag)
          const destGroupAssistants = [...destGroup!.assistants]

          // 未分组的情况 分组的加上
          const sourceAssitant = {
            ...sourceGroupAssistants.splice(source.index, 1)[0]
          }
          if (destTag === t('assistants.tags.untagged')) {
            delete sourceAssitant.tags
          } else {
            sourceAssitant.tags = [destGroup!.tag]
          }

          // 修改对应tag
          const _assistants = assistants.map((_) => {
            if (_.id === sourceAssitant.id) {
              const newAssistant = { ..._ }
              if (destTag === t('assistants.tags.untagged')) {
                delete newAssistant.tags
              } else {
                newAssistant.tags = [destGroup!.tag]
              }
              return newAssistant
            }
            return _
          })

          // 进行置换
          destGroupAssistants?.splice(destination.index, 0, sourceAssitant)

          return handleGroupReorder(
            [
              { tag: sourceTag, newGroup: sourceGroupAssistants },
              { tag: destTag, newGroup: destGroupAssistants }
            ],
            _assistants
          )
        }
        if (sourceTag === destTag) {
          // 移动到同一组
          const sourceGroup = getGroupedAssistants.find((g) => g.id === sourceTag)
          const sourceAssitant = sourceGroup!.assistants.splice(source.index, 1)
          sourceGroup!.assistants.splice(destination.index, 0, sourceAssitant[0])

          return handleGroupReorder([{ tag: sourceTag, newGroup: sourceGroup!.assistants }], assistants)
        }
      } else if (type === 'TAG') {
        const items = Array.from(allTags)
        const [reorderedItem] = items.splice(source.index - 1, 1)
        items.splice(destination.index - 1, 0, reorderedItem)
        updateTagsOrder(items)
      }
      result
      return
    },
    [allTags, assistants, getGroupedAssistants, handleGroupReorder, t, updateTagsOrder]
  )
  //尝试过使用两个DragableList 但是会有问题
  //也试过不用DragList 直接写 但是会有问题
  //发现只有这样写是符合预期效果的
  if (assistantsTabSortType === 'tags') {
    return (
      <Container className="assistants-tab" ref={containerRef}>
        <DragableList
          droppableProps={{ type: 'TAG' }}
          list={filteredGroupedAssistants.map((_) => ({ ..._, disabled: _.tag === t('assistants.tags.untagged') }))}
          onUpdate={() => {}}
          onDragEnd={handleGroupDragEnd}>
          {(group) => (
            <Droppable droppableId={group.tag} type="ASSISTANT">
              {(provided) => (
                <TagsContainer key={group.tag} {...provided.droppableProps} ref={provided.innerRef}>
                  {group.tag !== t('assistants.tags.untagged') && (
                    <GroupTitle onClick={() => toggleTagCollapse(group.tag)}>
                      <Tooltip title={group.tag}>
                        <GroupTitleName>
                          {collapsedTags[group.tag] ? (
                            <RightOutlined style={{ fontSize: '10px', marginRight: '5px' }} />
                          ) : (
                            <DownOutlined style={{ fontSize: '10px', marginRight: '5px' }} />
                          )}
                          {group.tag}
                        </GroupTitleName>
                      </Tooltip>
                      <GroupTitleDivider />
                    </GroupTitle>
                  )}
                  {!collapsedTags[group.tag] && (
                    <>
                      {group.assistants.map((assistant, index) => (
                        <Draggable
                          key={`draggable_${group.tag}_${assistant?.id}_${index}`}
                          draggableId={`draggable_${group.tag}_${assistant?.id}_${index}`}
                          index={index}>
                          {(provided) => (
                            <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                              <AssistantItem
                                key={assistant?.id}
                                assistant={assistant}
                                sortBy="tags"
                                isActive={assistant?.id === activeAssistant.id}
                                onSwitch={setActiveAssistant}
                                onDelete={onDelete}
                                addAssistant={addAssistant}
                                handleSortByChange={handleSortByChange}
                                onCreateDefaultAssistant={() => {}}
                                style={{ margin: '4px 0' }}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                    </>
                  )}
                  {provided.placeholder}
                </TagsContainer>
              )}
            </Droppable>
          )}
        </DragableList>
        <AssistantAddItem onClick={onCreateAssistant}>
          <AssistantName>
            <PlusOutlined style={{ color: 'var(--color-text-2)', marginRight: 4 }} />
            {t('chat.add.assistant.title')}
          </AssistantName>
        </AssistantAddItem>
      </Container>
    )
  }

  return (
    <Container className="assistants-tab" ref={containerRef}>
      <DragableList
        list={filteredAssistants}
        onUpdate={updateAssistants}
        style={{ paddingBottom: dragging ? '34px' : 0 }}
        onDragStart={() => setDragging(true)}
        onDragEnd={() => setDragging(false)}>
        {(assistant) => (
          <AssistantItem
            key={assistant.id}
            assistant={assistant}
            isActive={assistant.id === activeAssistant.id}
            sortBy={assistantsTabSortType}
            onSwitch={setActiveAssistant}
            onDelete={onDelete}
            addAssistant={addAssistant}
            onCreateDefaultAssistant={onCreateDefaultAssistant}
            handleSortByChange={handleSortByChange}
          />
        )}
      </DragableList>
      {!dragging && (
        <AssistantAddItem onClick={onCreateAssistant}>
          <AssistantName>
            <PlusOutlined style={{ color: 'var(--color-text-2)', marginRight: 4 }} />
            {t('chat.add.assistant.title')}
          </AssistantName>
        </AssistantAddItem>
      )}
      <div style={{ minHeight: 10 }}></div>
    </Container>
  )
}

// 样式组件
const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding: 0 10px;
`

const TagsContainer = styled.div`
  display: flex;
  flex-direction: column;
`

const AssistantAddItem = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 7px 12px;
  position: relative;
  padding-right: 35px;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid transparent;
  cursor: pointer;

  &:hover {
    background-color: var(--color-list-item-hover);
  }
`

const GroupTitle = styled.div`
  color: var(--color-text-2);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  height: 24px;
  margin: 5px 0;
`

const GroupTitleName = styled.div`
  max-width: 50%;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  box-sizing: border-box;
  padding: 0 4px;
  color: var(--color-text);
  font-size: 13px;
  line-height: 24px;
  margin-right: 5px;
  display: flex;
`

const GroupTitleDivider = styled.div`
  flex: 1;
  border-top: 1px solid var(--color-border);
`

const AssistantName = styled.div`
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
`

export default Assistants
