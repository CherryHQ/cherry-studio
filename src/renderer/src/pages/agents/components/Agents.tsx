import AddButton from '@renderer/components/AddButton'
import DraggableVirtualList from '@renderer/components/DraggableList/virtual-list'
import AgentModalPopup from '@renderer/components/Popups/agent/AgentModal'
import { useCache } from '@renderer/data/hooks/useCache'
import { useActiveAgent } from '@renderer/hooks/agents/useActiveAgent'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useApiServer } from '@renderer/hooks/useApiServer'
import type { AgentEntity } from '@renderer/types'
import { X } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as tinyPinyin from 'tiny-pinyin'

import AgentItem from './AgentItem'

interface AgentsProps {
  onSelectItem?: () => void
}

const Agents = ({ onSelectItem }: AgentsProps) => {
  const { t } = useTranslation()
  const { agents, deleteAgent, duplicateAgent, clearAgentSessions, deleteAgents, isLoading, error, reorderAgents } =
    useAgents()
  const { apiServerRunning, startApiServer } = useApiServer()
  const [activeAgentId] = useCache('agent.active_id')
  const { setActiveAgentId } = useActiveAgent()

  const [manageMode, setManageMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const handleAgentPress = useCallback(
    (agentId: string) => {
      if (manageMode) return
      void setActiveAgentId(agentId)
      onSelectItem?.()
    },
    [manageMode, setActiveAgentId, onSelectItem]
  )

  const handleAddAgent = useCallback(() => {
    void (!apiServerRunning && startApiServer())
    void AgentModalPopup.show({
      afterSubmit: (agent: AgentEntity) => {
        void setActiveAgentId(agent.id)
      }
    })
  }, [apiServerRunning, startApiServer, setActiveAgentId])

  const toggleManageMode = useCallback(() => {
    setManageMode((prev) => {
      if (!prev) setSelectedIds(new Set())
      return !prev
    })
  }, [])

  const handleSelectAgent = useCallback((agent: AgentEntity) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(agent.id)) {
        next.delete(agent.id)
      } else {
        next.add(agent.id)
      }
      return next
    })
  }, [])

  const handleBatchDelete = useCallback(() => {
    const ids = Array.from(selectedIds)
    window.modal.confirm({
      title: t('agent.manage.batch_delete.confirm'),
      content: t('agent.manage.batch_delete.content', { count: ids.length }),
      centered: true,
      okButtonProps: { danger: true },
      onOk: () => {
        void deleteAgents(ids)
        setSelectedIds(new Set())
        setManageMode(false)
      }
    })
  }, [selectedIds, deleteAgents, t])

  const sortByPinyin = useCallback(
    (order: 'asc' | 'desc') => {
      const sorted = [...(agents ?? [])].sort((a, b) => {
        const nameA = tinyPinyin.convertToPinyin(a.name ?? '', '', true)
        const nameB = tinyPinyin.convertToPinyin(b.name ?? '', '', true)
        if (order === 'asc') {
          return nameA.localeCompare(nameB)
        } else {
          return nameB.localeCompare(nameA)
        }
      })
      void reorderAgents(sorted)
    },
    [agents, reorderAgents]
  )

  if (isLoading) {
    return <div className="p-5 text-center text-(--color-text-secondary) text-[13px]">{t('common.loading')}</div>
  }

  if (error) {
    return <div className="p-5 text-center text-(--color-error) text-[13px]">{error.message}</div>
  }

  const header = manageMode ? (
    <div className="mb-1.5 flex flex-row items-center justify-between">
      <span className="text-(--color-text-secondary) text-[13px]">
        {t('agent.manage.title')} ({selectedIds.size})
      </span>
      <div className="flex flex-row items-center gap-1">
        {selectedIds.size > 0 && (
          <button
            onClick={handleBatchDelete}
            className="rounded px-2 py-0.5 text-[12px] text-red-500 hover:bg-red-500/10">
            {t('common.delete')}
          </button>
        )}
        <button
          onClick={toggleManageMode}
          className="rounded px-2 py-0.5 text-[12px] text-(--color-text-secondary) hover:bg-(--color-list-item-hover)">
          <X size={14} />
        </button>
      </div>
    </div>
  ) : (
    <div className="-mt-0.5 mb-1.5 flex flex-row items-center justify-between">
      <AddButton onClick={handleAddAgent}>{t('agent.sidebar_title')}</AddButton>
      <button
        onClick={toggleManageMode}
        className="rounded px-2 py-0.5 text-[12px] text-(--color-text-secondary) hover:bg-(--color-list-item-hover)">
        {t('agent.manage.title')}
      </button>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <DraggableVirtualList
        className="agents-tab flex min-h-0 flex-1 flex-col"
        itemStyle={{ marginBottom: 8 }}
        list={agents ?? []}
        estimateSize={() => 9 * 4}
        scrollerStyle={{ overflowX: 'hidden', padding: '12px 10px' }}
        onUpdate={manageMode ? undefined : reorderAgents}
        itemKey={(index) => (agents ?? [])[index]?.id ?? index}
        header={header}>
        {(agent) => (
          <AgentItem
            agent={agent}
            isActive={agent.id === activeAgentId}
            showManageCheckbox={manageMode}
            isSelected={selectedIds.has(agent.id)}
            onDelete={() => deleteAgent(agent.id)}
            onDuplicate={() => duplicateAgent(agent.id)}
            onClear={() => clearAgentSessions(agent.id)}
            onSelect={handleSelectAgent}
            onSortByPinyinAsc={() => sortByPinyin('asc')}
            onSortByPinyinDesc={() => sortByPinyin('desc')}
            onPress={() => handleAgentPress(agent.id)}
          />
        )}
      </DraggableVirtualList>
    </div>
  )
}

export default memo(Agents)
