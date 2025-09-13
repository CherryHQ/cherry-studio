import { LoadingIcon } from '@renderer/components/Icons'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { QuickPanelListItem, QuickPanelOpenOptions } from '@renderer/components/QuickPanel/types'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useAppDispatch } from '@renderer/store'
import { removeAssistantTodo } from '@renderer/store/assistants'
import { TodoAction, TodoStatus } from '@renderer/types/todos'
import { Tooltip } from 'antd'
import { Ban, CircleCheck, CircleDashed, CircleX, ClipboardList, Clock, SendHorizonal } from 'lucide-react'
import { memo, useCallback, useEffect, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export interface TodosButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<TodosButtonRef | null>
  ToolbarButton: any
  assistantId: string
  topicId: string
}

const TodosButton = ({ ref, ToolbarButton, assistantId, topicId }: Props) => {
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const { assistant } = useAssistant(assistantId)
  const dispatch = useAppDispatch()

  const panelSymbol = 'todos'
  const todos = useMemo(() => [...(assistant.todos?.[topicId] || [])], [assistant.todos, topicId])

  const panelItems = useMemo<QuickPanelListItem[]>(() => {
    const items: QuickPanelListItem[] = todos.map((todo) => ({
      label: (
        <div className="flex items-center gap-2">
          {actionIcon(todo.action)}
          {todo.title}
        </div>
      ),
      description: new Date(todo.updatedAt || todo.createdAt).toLocaleString(),
      icon: statusIcon(todo.status),
      action: () => {}
    }))

    items.unshift({
      label: t('settings.input.clear.all'),
      description: t('todos.clear_all'),
      icon: <CircleX />,
      action: () => {
        todos.forEach((t) => {
          dispatch(removeAssistantTodo({ assistantId: assistant.id, topicId, todoId: t.id }))
        })
      }
    })

    return items
  }, [assistant.id, dispatch, t, todos, topicId])

  const openOptions = useMemo<QuickPanelOpenOptions>(
    () => ({ title: t('todos.title'), list: panelItems, symbol: panelSymbol }),
    [panelItems, t]
  )

  const openQuickPanel = useCallback(() => {
    quickPanel.open(openOptions)
  }, [quickPanel, openOptions])

  const handleToggle = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === panelSymbol) {
      quickPanel.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  useEffect(() => {
    if (quickPanel.isVisible && quickPanel.symbol === panelSymbol) {
      quickPanel.updateList(panelItems)
    }
  }, [panelItems, quickPanel])

  useImperativeHandle(ref, () => ({ openQuickPanel }))

  return (
    <Tooltip placement="top" title={t('todos.title')} mouseLeaveDelay={0} arrow>
      <ToolbarButton type="text" onClick={handleToggle}>
        <ClipboardList size={18} />
      </ToolbarButton>
    </Tooltip>
  )
}

const statusIcon = (status?: TodoStatus, size = 12) => {
  switch (status) {
    case TodoStatus.Failed:
      return <Ban size={size} />
    case TodoStatus.Done:
      return <CircleCheck size={size} />
    case TodoStatus.Processing:
      return <LoadingIcon size={size} />
    case TodoStatus.Pending:
      return <CircleDashed size={size} />
    default:
      return <CircleDashed size={size} />
  }
}

const actionIcon = (action?: TodoAction, size = 12) => {
  switch (action) {
    case TodoAction.SendMessage:
      return <SendHorizonal size={size} />
    default:
      return <Clock size={size} />
  }
}

export default memo(TodosButton)
