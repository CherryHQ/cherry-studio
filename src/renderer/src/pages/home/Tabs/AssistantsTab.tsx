import { Alert, Spinner } from '@heroui/react'
import { DraggableList } from '@renderer/components/DraggableList'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useAgentSessionInitializer } from '@renderer/hooks/agents/useAgentSessionInitializer'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAssistantsTabSortType } from '@renderer/hooks/useStore'
import { useTags } from '@renderer/hooks/useTags'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setUnifiedListOrder } from '@renderer/store/assistants'
import { addIknowAction, setActiveAgentId as setActiveAgentIdAction } from '@renderer/store/runtime'
import { AgentEntity, Assistant, AssistantsSortType } from '@renderer/types'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import * as tinyPinyin from 'tiny-pinyin'

import AgentItem from './components/AgentItem'
import AssistantItem from './components/AssistantItem'
import { TagGroup } from './components/TagGroup'
import UnifiedAddButton from './components/UnifiedAddButton'

interface AssistantsTabProps {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  onCreateAssistant: () => void
  onCreateDefaultAssistant: () => void
}

type UnifiedItem = { type: 'agent'; data: AgentEntity } | { type: 'assistant'; data: Assistant }

const ALERT_KEY = 'enable_api_server_to_use_agent'

const AssistantsTab: FC<AssistantsTabProps> = (props) => {
  const { activeAssistant, setActiveAssistant, onCreateAssistant, onCreateDefaultAssistant } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  const { apiServer } = useSettings()
  const { iknow, chat } = useRuntime()
  const dispatch = useAppDispatch()

  // Agent related hooks
  const { agents, deleteAgent, isLoading: agentsLoading, error: agentsError } = useAgents()
  const { activeAgentId } = chat
  const { initializeAgentSession } = useAgentSessionInitializer()

  // Assistant related hooks
  const { assistants, removeAssistant, copyAssistant, updateAssistants } = useAssistants()
  const { addAssistantPreset } = useAssistantPresets()
  const { collapsedTags, toggleTagCollapse } = useTags()
  const { assistantsTabSortType = 'list', setAssistantsTabSortType } = useAssistantsTabSortType()
  const [dragging, setDragging] = useState(false)
  const unifiedListOrder = useAppSelector((state) => state.assistants.unifiedListOrder || [])

  const setActiveAgentId = useCallback(
    async (id: string) => {
      dispatch(setActiveAgentIdAction(id))
      await initializeAgentSession(id)
    },
    [dispatch, initializeAgentSession]
  )

  useEffect(() => {
    if (!agentsLoading && agents.length > 0 && !activeAgentId && apiServer.enabled) {
      setActiveAgentId(agents[0].id)
    }
  }, [agentsLoading, agents, activeAgentId, setActiveAgentId, apiServer.enabled])

  const onDeleteAssistant = useCallback(
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

  const handleSortByChange = useCallback(
    (sortType: AssistantsSortType) => {
      setAssistantsTabSortType(sortType)
    },
    [setAssistantsTabSortType]
  )

  // Pinyin sort functions for unified list
  const sortUnifiedItemsByPinyin = useCallback((items: UnifiedItem[], isAscending: boolean) => {
    return [...items].sort((a, b) => {
      const nameA = a.type === 'agent' ? a.data.name || a.data.id : a.data.name
      const nameB = b.type === 'agent' ? b.data.name || b.data.id : b.data.name
      const pinyinA = tinyPinyin.convertToPinyin(nameA, '', true)
      const pinyinB = tinyPinyin.convertToPinyin(nameB, '', true)
      return isAscending ? pinyinA.localeCompare(pinyinB) : pinyinB.localeCompare(pinyinA)
    })
  }, [])

  // Create unified items list (agents + assistants) with saved order
  const unifiedItems = useMemo(() => {
    const items: UnifiedItem[] = []

    // Collect all available items
    const availableAgents = new Map<string, AgentEntity>()
    const availableAssistants = new Map<string, Assistant>()

    if (apiServer.enabled && !agentsLoading && !agentsError) {
      agents.forEach((agent) => availableAgents.set(agent.id, agent))
    }
    assistants.forEach((assistant) => availableAssistants.set(assistant.id, assistant))

    // Apply saved order
    unifiedListOrder.forEach((item) => {
      if (item.type === 'agent' && availableAgents.has(item.id)) {
        items.push({ type: 'agent', data: availableAgents.get(item.id)! })
        availableAgents.delete(item.id)
      } else if (item.type === 'assistant' && availableAssistants.has(item.id)) {
        items.push({ type: 'assistant', data: availableAssistants.get(item.id)! })
        availableAssistants.delete(item.id)
      }
    })

    // Add new items (not in saved order) to the end
    availableAgents.forEach((agent) => items.push({ type: 'agent', data: agent }))
    availableAssistants.forEach((assistant) => items.push({ type: 'assistant', data: assistant }))

    return items
  }, [agents, assistants, apiServer.enabled, agentsLoading, agentsError, unifiedListOrder])

  const sortByPinyinAsc = useCallback(() => {
    const sorted = sortUnifiedItemsByPinyin(unifiedItems, true)
    const orderToSave = sorted.map((item) => ({
      type: item.type,
      id: item.data.id
    }))
    dispatch(setUnifiedListOrder(orderToSave))
    // Also update assistants order
    const newAssistants = sorted.filter((item) => item.type === 'assistant').map((item) => item.data)
    updateAssistants(newAssistants)
  }, [unifiedItems, sortUnifiedItemsByPinyin, dispatch, updateAssistants])

  const sortByPinyinDesc = useCallback(() => {
    const sorted = sortUnifiedItemsByPinyin(unifiedItems, false)
    const orderToSave = sorted.map((item) => ({
      type: item.type,
      id: item.data.id
    }))
    dispatch(setUnifiedListOrder(orderToSave))
    // Also update assistants order
    const newAssistants = sorted.filter((item) => item.type === 'assistant').map((item) => item.data)
    updateAssistants(newAssistants)
  }, [unifiedItems, sortUnifiedItemsByPinyin, dispatch, updateAssistants])

  const handleUnifiedListReorder = useCallback(
    (newList: UnifiedItem[]) => {
      // Save the unified order to Redux
      const orderToSave = newList.map((item) => ({
        type: item.type,
        id: item.data.id
      }))
      dispatch(setUnifiedListOrder(orderToSave))

      // Extract and update assistants order
      const newAssistants = newList.filter((item) => item.type === 'assistant').map((item) => item.data)
      updateAssistants(newAssistants)
    },
    [dispatch, updateAssistants]
  )

  // Group unified items by tags
  const groupedUnifiedItems = useMemo(() => {
    const groups = new Map<string, UnifiedItem[]>()

    unifiedItems.forEach((item) => {
      if (item.type === 'agent') {
        // Agents go to a special "Agents" group or untagged
        const groupKey = t('assistants.tags.untagged')
        if (!groups.has(groupKey)) {
          groups.set(groupKey, [])
        }
        groups.get(groupKey)!.push(item)
      } else {
        // Assistants use their tags
        const tags = item.data.tags?.length ? item.data.tags : [t('assistants.tags.untagged')]
        tags.forEach((tag) => {
          if (!groups.has(tag)) {
            groups.set(tag, [])
          }
          groups.get(tag)!.push(item)
        })
      }
    })

    // Sort groups: untagged first, then tagged groups
    const untaggedKey = t('assistants.tags.untagged')
    const sortedGroups = Array.from(groups.entries()).sort(([tagA], [tagB]) => {
      if (tagA === untaggedKey) return -1
      if (tagB === untaggedKey) return 1
      return 0
    })

    return sortedGroups.map(([tag, items]) => ({ tag, items }))
  }, [unifiedItems, t])

  const handleUnifiedGroupReorder = useCallback(
    (tag: string, newGroupList: UnifiedItem[]) => {
      // Extract only assistants from the new list for updating
      const newAssistants = newGroupList.filter((item) => item.type === 'assistant').map((item) => item.data)

      // Update assistants state
      let insertIndex = 0
      const updatedAssistants = assistants.map((a) => {
        const tags = a.tags?.length ? a.tags : [t('assistants.tags.untagged')]
        if (tags.includes(tag)) {
          const replaced = newAssistants[insertIndex]
          insertIndex += 1
          return replaced || a
        }
        return a
      })
      updateAssistants(updatedAssistants)

      // Rebuild unified order and save to Redux
      const newUnifiedItems: UnifiedItem[] = []
      const availableAgents = new Map<string, AgentEntity>()
      const availableAssistants = new Map<string, Assistant>()

      if (apiServer.enabled && !agentsLoading && !agentsError) {
        agents.forEach((agent) => availableAgents.set(agent.id, agent))
      }
      updatedAssistants.forEach((assistant) => availableAssistants.set(assistant.id, assistant))

      // Reconstruct order based on current groupedUnifiedItems structure
      groupedUnifiedItems.forEach((group) => {
        if (group.tag === tag) {
          // Use the new group list for this tag
          newGroupList.forEach((item) => {
            newUnifiedItems.push(item)
            if (item.type === 'agent') {
              availableAgents.delete(item.data.id)
            } else {
              availableAssistants.delete(item.data.id)
            }
          })
        } else {
          // Keep existing order for other tags
          group.items.forEach((item) => {
            newUnifiedItems.push(item)
            if (item.type === 'agent') {
              availableAgents.delete(item.data.id)
            } else {
              availableAssistants.delete(item.data.id)
            }
          })
        }
      })

      // Add any remaining items
      availableAgents.forEach((agent) => newUnifiedItems.push({ type: 'agent', data: agent }))
      availableAssistants.forEach((assistant) => newUnifiedItems.push({ type: 'assistant', data: assistant }))

      // Save to Redux
      const orderToSave = newUnifiedItems.map((item) => ({
        type: item.type,
        id: item.data.id
      }))
      dispatch(setUnifiedListOrder(orderToSave))
    },
    [
      assistants,
      t,
      updateAssistants,
      apiServer.enabled,
      agentsLoading,
      agentsError,
      agents,
      groupedUnifiedItems,
      dispatch
    ]
  )

  const renderUnifiedItem = useCallback(
    (item: UnifiedItem) => {
      if (item.type === 'agent') {
        return (
          <AgentItem
            key={`agent-${item.data.id}`}
            agent={item.data}
            isActive={item.data.id === activeAgentId}
            onDelete={() => deleteAgent(item.data.id)}
            onPress={() => setActiveAgentId(item.data.id)}
          />
        )
      } else {
        return (
          <AssistantItem
            key={`assistant-${item.data.id}`}
            assistant={item.data}
            isActive={item.data.id === activeAssistant.id}
            sortBy={assistantsTabSortType}
            onSwitch={setActiveAssistant}
            onDelete={onDeleteAssistant}
            addPreset={addAssistantPreset}
            copyAssistant={copyAssistant}
            onCreateDefaultAssistant={onCreateDefaultAssistant}
            handleSortByChange={handleSortByChange}
            sortByPinyinAsc={sortByPinyinAsc}
            sortByPinyinDesc={sortByPinyinDesc}
          />
        )
      }
    },
    [
      activeAgentId,
      activeAssistant,
      assistantsTabSortType,
      setActiveAssistant,
      onDeleteAssistant,
      addAssistantPreset,
      copyAssistant,
      onCreateDefaultAssistant,
      handleSortByChange,
      deleteAgent,
      setActiveAgentId,
      sortByPinyinAsc,
      sortByPinyinDesc
    ]
  )

  // Render unified items with tags
  const renderUnifiedWithTags = () => {
    return (
      <div>
        {groupedUnifiedItems.map((group) => (
          <TagGroup
            key={group.tag}
            tag={group.tag}
            isCollapsed={collapsedTags[group.tag]}
            onToggle={toggleTagCollapse}
            showTitle={group.tag !== t('assistants.tags.untagged')}>
            <DraggableList
              list={group.items}
              itemKey={(item) => `${item.type}-${item.data.id}`}
              onUpdate={(newList) => handleUnifiedGroupReorder(group.tag, newList)}
              onDragStart={() => setDragging(true)}
              onDragEnd={() => setDragging(false)}>
              {renderUnifiedItem}
            </DraggableList>
          </TagGroup>
        ))}
      </div>
    )
  }

  // Render unified items as list
  const renderUnifiedList = () => {
    return (
      <DraggableList
        list={unifiedItems}
        itemKey={(item) => `${item.type}-${item.data.id}`}
        onUpdate={handleUnifiedListReorder}
        onDragStart={() => setDragging(true)}
        onDragEnd={() => setDragging(false)}>
        {renderUnifiedItem}
      </DraggableList>
    )
  }

  return (
    <Container className="assistants-tab" ref={containerRef}>
      {!apiServer.enabled && !iknow[ALERT_KEY] && (
        <Alert
          color="warning"
          title={t('agent.warning.enable_server')}
          isClosable
          onClose={() => {
            dispatch(addIknowAction(ALERT_KEY))
          }}
        />
      )}

      <UnifiedAddButton onCreateAssistant={onCreateAssistant} />

      {agentsLoading && <Spinner />}
      {apiServer.enabled && agentsError && <Alert color="danger" title={t('agent.list.error.failed')} />}

      {assistantsTabSortType === 'tags' ? renderUnifiedWithTags() : renderUnifiedList()}

      {!dragging && <div style={{ minHeight: 10 }}></div>}
    </Container>
  )
}

const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding: 10px;
  margin-top: 3px;
`

export default AssistantsTab
