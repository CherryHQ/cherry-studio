import { QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useWorkflows } from '@renderer/hooks/useFlowEngineProvider'
import { Assistant, Workflow } from '@renderer/types'
import { Tooltip } from 'antd'
import { GitCompare, Settings } from 'lucide-react'
import { FC, useCallback, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

export interface WorkflowButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<WorkflowButtonRef | null>
  assistant: Assistant
  ToolbarButton: any
}

const WorkflowButton: FC<Props> = ({ ref, assistant, ToolbarButton }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const quickPanel = useQuickPanel()
  const { workflows } = useWorkflows()
  const { updateAssistant } = useAssistant(assistant.id)

  const updateSelectedWorkflow = useCallback(
    (workflow: Workflow | undefined) => {
      setTimeout(() => {
        if (assistant.workflow === workflow) {
          updateAssistant({ ...assistant, workflow: undefined })
        } else {
          updateAssistant({ ...assistant, workflow: workflow })
        }
      }, 200)
    },
    [assistant, updateAssistant]
  )

  const providerItems = useMemo<QuickPanelListItem[]>(() => {
    const items: QuickPanelListItem[] = workflows.map((p) => ({
      label: p.name,
      description: p.description,
      icon: <GitCompare />,
      isSelected: p === assistant.workflow,
      disabled: !p.enabled,
      action: () => updateSelectedWorkflow(p)
    }))

    items.push({
      label: '前往设置' + '...',
      icon: <Settings />,
      action: () => navigate('/settings/workflow')
    })

    return items
  }, [assistant, workflows, t, updateSelectedWorkflow, navigate])

  const openQuickPanel = useCallback(() => {
    quickPanel.open({
      title: t('chat.input.workflow'),
      list: providerItems,
      symbol: '?'
    })
  }, [quickPanel, providerItems, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === '?') {
      quickPanel.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip placement="top" title={t('chat.input.workflow')} arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        <GitCompare
          size={18}
          style={{
            color: assistant?.workflow ? 'var(--color-link)' : 'var(--color-icon)'
          }}
        />
      </ToolbarButton>
    </Tooltip>
  )
}

export default WorkflowButton
