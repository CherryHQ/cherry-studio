import { Alert, Spinner } from '@heroui/react'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useAssistantsTabSortType } from '@renderer/hooks/useStore'
import { useTags } from '@renderer/hooks/useTags'
import { useAppDispatch } from '@renderer/store'
import { addIknowAction } from '@renderer/store/runtime'
import { Assistant, AssistantsSortType } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import UnifiedAddButton from './components/UnifiedAddButton'
import { UnifiedList } from './components/UnifiedList'
import { UnifiedTagGroups } from './components/UnifiedTagGroups'
import { useActiveAgent } from './hooks/useActiveAgent'
import { useUnifiedGrouping } from './hooks/useUnifiedGrouping'
import { useUnifiedItems } from './hooks/useUnifiedItems'
import { useUnifiedSorting } from './hooks/useUnifiedSorting'

interface AssistantsTabProps {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  onCreateAssistant: () => void
  onCreateDefaultAssistant: () => void
}

const ALERT_KEY = 'enable_api_server_to_use_agent'

const AssistantsTab: FC<AssistantsTabProps> = (props) => {
  const { activeAssistant, setActiveAssistant, onCreateAssistant, onCreateDefaultAssistant } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  const { apiServerConfig, apiServerRunning } = useApiServer()
  const apiServerEnabled = apiServerConfig.enabled
  const { iknow, chat } = useRuntime()
  const dispatch = useAppDispatch()

  // Agent related hooks
  const { agents, deleteAgent, isLoading: agentsLoading, error: agentsError } = useAgents()
  const { activeAgentId } = chat
  const { setActiveAgentId } = useActiveAgent()

  // Assistant related hooks
  const { assistants, removeAssistant, copyAssistant, updateAssistants } = useAssistants()
  const { addAssistantPreset } = useAssistantPresets()
  const { collapsedTags, toggleTagCollapse } = useTags()
  const { assistantsTabSortType = 'list', setAssistantsTabSortType } = useAssistantsTabSortType()
  const [dragging, setDragging] = useState(false)

  // Unified items management
  const { unifiedItems, handleUnifiedListReorder } = useUnifiedItems({
    agents,
    assistants,
    apiServerEnabled,
    agentsLoading,
    agentsError,
    updateAssistants
  })

  // Sorting
  const { sortByPinyinAsc, sortByPinyinDesc } = useUnifiedSorting({
    unifiedItems,
    updateAssistants
  })

  // Grouping
  const { groupedUnifiedItems, handleUnifiedGroupReorder } = useUnifiedGrouping({
    unifiedItems,
    assistants,
    agents,
    apiServerEnabled,
    agentsLoading,
    agentsError,
    updateAssistants
  })

  useEffect(() => {
    if (!agentsLoading && agents.length > 0 && !activeAgentId && apiServerConfig.enabled) {
      setActiveAgentId(agents[0].id)
    }
  }, [agentsLoading, agents, activeAgentId, setActiveAgentId, apiServerConfig.enabled])

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

  return (
    <Container className="assistants-tab" ref={containerRef}>
      {!apiServerConfig.enabled && !iknow[ALERT_KEY] && (
        <Alert
          color="warning"
          title={t('agent.warning.enable_server')}
          isClosable
          onClose={() => {
            dispatch(addIknowAction(ALERT_KEY))
          }}
        />
      )}

      {agentsLoading && <Spinner />}
      {apiServerConfig.enabled && !apiServerRunning && (
        <Alert color="danger" title={t('agent.server.error.not_running')} isClosable />
      )}
      {apiServerConfig.enabled && apiServerRunning && agentsError && (
        <Alert color="danger" title={t('agent.list.error.failed')} description={getErrorMessage(agentsError)} />
      )}

      {assistantsTabSortType === 'tags' ? (
        <UnifiedTagGroups
          groupedItems={groupedUnifiedItems}
          activeAssistantId={activeAssistant.id}
          activeAgentId={activeAgentId}
          sortBy={assistantsTabSortType}
          collapsedTags={collapsedTags}
          onGroupReorder={handleUnifiedGroupReorder}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
          onToggleTagCollapse={toggleTagCollapse}
          onAssistantSwitch={setActiveAssistant}
          onAssistantDelete={onDeleteAssistant}
          onAgentDelete={deleteAgent}
          onAgentPress={setActiveAgentId}
          addPreset={addAssistantPreset}
          copyAssistant={copyAssistant}
          onCreateDefaultAssistant={onCreateDefaultAssistant}
          handleSortByChange={handleSortByChange}
          sortByPinyinAsc={sortByPinyinAsc}
          sortByPinyinDesc={sortByPinyinDesc}
        />
      ) : (
        <UnifiedList
          items={unifiedItems}
          activeAssistantId={activeAssistant.id}
          activeAgentId={activeAgentId}
          sortBy={assistantsTabSortType}
          onReorder={handleUnifiedListReorder}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
          onAssistantSwitch={setActiveAssistant}
          onAssistantDelete={onDeleteAssistant}
          onAgentDelete={deleteAgent}
          onAgentPress={setActiveAgentId}
          addPreset={addAssistantPreset}
          copyAssistant={copyAssistant}
          onCreateDefaultAssistant={onCreateDefaultAssistant}
          handleSortByChange={handleSortByChange}
          sortByPinyinAsc={sortByPinyinAsc}
          sortByPinyinDesc={sortByPinyinDesc}
        />
      )}

      <UnifiedAddButton onCreateAssistant={onCreateAssistant} />

      {!dragging && <div style={{ minHeight: 10 }}></div>}
    </Container>
  )
}

const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding: 10px;
`

export default AssistantsTab
