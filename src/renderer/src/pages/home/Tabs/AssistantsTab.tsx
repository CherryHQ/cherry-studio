import { DownOutlined, RightOutlined } from '@ant-design/icons'
import { Button, Divider } from '@heroui/react'
import { DraggableList } from '@renderer/components/DraggableList'
import { AgentModal } from '@renderer/components/Popups/AgentModal'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import { useAssistantsTabSortType } from '@renderer/hooks/useStore'
import { useTags } from '@renderer/hooks/useTags'
import { AgentEntity, Assistant, AssistantsSortType } from '@renderer/types'
import { Tooltip } from 'antd'
import { Plus } from 'lucide-react'
import { FC, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AgentItem from './components/AgentItem'
import AssistantItem from './components/AssistantItem'

interface AssistantsTabProps {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  onCreateAssistant: () => void
  onCreateDefaultAssistant: () => void
}
const Assistants: FC<AssistantsTabProps> = ({
  activeAssistant,
  setActiveAssistant,
  onCreateAssistant,
  onCreateDefaultAssistant
}) => {
  const { assistants, removeAssistant, copyAssistant, updateAssistants } = useAssistants()
  const [dragging, setDragging] = useState(false)
  const { addAssistantPreset } = useAssistantPresets()
  const { t } = useTranslation()
  const { getGroupedAssistants, collapsedTags, toggleTagCollapse } = useTags()
  const { assistantsTabSortType = 'list', setAssistantsTabSortType } = useAssistantsTabSortType()
  const containerRef = useRef<HTMLDivElement>(null)
  const { agents } = useAgents()

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

  const onDeleteAgent = useCallback(
    (agent: AgentEntity) => {
      // removeAgent(agent.id)
      window.toast.success(t('common.delete_success'))
    },
    [t]
  )

  const handleSortByChange = useCallback(
    (sortType: AssistantsSortType) => {
      setAssistantsTabSortType(sortType)
    },
    [setAssistantsTabSortType]
  )

  const handleGroupReorder = useCallback(
    (tag: string, newGroupList: Assistant[]) => {
      let insertIndex = 0
      const newGlobal = assistants.map((a) => {
        const tags = a.tags?.length ? a.tags : [t('assistants.tags.untagged')]
        if (tags.includes(tag)) {
          const replaced = newGroupList[insertIndex]
          insertIndex += 1
          return replaced
        }
        return a
      })
      updateAssistants(newGlobal)
    },
    [assistants, t, updateAssistants]
  )

  const renderAddAssistantButton = useMemo(() => {
    return (
      <Button onPress={onCreateAssistant} className="justify-start bg-transparent text-foreground-500 hover:bg-accent">
        <Plus size={16} style={{ marginRight: 4, flexShrink: 0 }} />
        {t('chat.add.assistant.title')}
      </Button>
    )
  }, [onCreateAssistant, t])

  if (assistantsTabSortType === 'tags') {
    return (
      <Container className="assistants-tab" ref={containerRef}>
        <div style={{ marginBottom: '8px' }}>
          {getGroupedAssistants.map((group) => (
            <TagsContainer key={group.tag}>
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
                <div>
                  <DraggableList
                    list={group.assistants}
                    onUpdate={(newList) => handleGroupReorder(group.tag, newList)}
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
                        addPreset={addAssistantPreset}
                        copyAssistant={copyAssistant}
                        onCreateDefaultAssistant={onCreateDefaultAssistant}
                        handleSortByChange={handleSortByChange}
                      />
                    )}
                  </DraggableList>
                </div>
              )}
            </TagsContainer>
          ))}
        </div>
        {renderAddAssistantButton}
        {/* <AddAgentButton /> */}
      </Container>
    )
  }

  return (
    <Container className="assistants-tab" ref={containerRef}>
      <span className="mb-2 text-foreground-400 text-xs">{t('common.agent_other')}</span>
      {agents.map((agent) => (
        <AgentItem key={agent.id} agent={agent} isActive={false} onDelete={onDeleteAgent} />
      ))}
      <AgentModal
        trigger={{
          content: (
            <Button
              onPress={(e) => e.continuePropagation()}
              className="w-full justify-start bg-transparent text-foreground-500 hover:bg-accent">
              <Plus size={16} className="mr-1 shrink-0" />
              {t('agent.add.title')}
            </Button>
          )
        }}
      />

      <Divider className="my-2" />
      <span className="mb-2 text-foreground-400 text-xs">{t('common.assistant_other')}</span>
      <DraggableList
        list={assistants}
        onUpdate={updateAssistants}
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
            addPreset={addAssistantPreset}
            copyAssistant={copyAssistant}
            onCreateDefaultAssistant={onCreateDefaultAssistant}
            handleSortByChange={handleSortByChange}
          />
        )}
      </DraggableList>
      {!dragging && renderAddAssistantButton}
      <div style={{ minHeight: 10 }}></div>
    </Container>
  )
}

// 样式组件
const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding: 10px;
  margin-top: 3px;
`

const TagsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
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

export default Assistants
