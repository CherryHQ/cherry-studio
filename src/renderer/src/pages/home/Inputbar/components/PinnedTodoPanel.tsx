import { CheckCircle, ChevronDown, ChevronUp, Circle, Clock } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { TodoItem } from '../../Messages/Tools/MessageAgentTools/types'
import { useActiveTodos } from '../hooks/useActiveTodos'

/**
 * Get the status icon for a todo item
 */
function getTodoStatusIcon(status: TodoItem['status']) {
  switch (status) {
    case 'completed':
      return <CheckCircle size={14} className="text-green-500" />
    case 'in_progress':
      return <Clock size={14} className="text-blue-500" />
    case 'pending':
    default:
      return <Circle size={14} className="text-gray-400" />
  }
}

/**
 * Get the translation key for a todo status
 */
function getStatusTranslationKey(status: TodoItem['status']): string {
  switch (status) {
    case 'pending':
      return 'agent.todo.status.pending'
    case 'in_progress':
      return 'agent.todo.status.in_progress'
    default:
      return 'agent.todo.status.pending'
  }
}

/**
 * PinnedTodoPanel - Displays active todos in a fixed panel above the inputbar
 *
 * This panel shows todos that are not yet completed (pending or in_progress).
 * When all todos are completed, this panel disappears.
 */
export const PinnedTodoPanel: FC = () => {
  const { t } = useTranslation()
  const activeTodoInfo = useActiveTodos()
  const [isCollapsed, setIsCollapsed] = useState(false)

  if (!activeTodoInfo) {
    return null
  }

  const { incompleteTodos, completedCount, totalCount } = activeTodoInfo

  return (
    <Container>
      <PanelBody>
        <PanelHeader onClick={() => setIsCollapsed(!isCollapsed)}>
          <HeaderTitle>{t('agent.todo.panel.title', { completed: completedCount, total: totalCount })}</HeaderTitle>
          {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </PanelHeader>
        <TodoList $collapsed={isCollapsed}>
          {incompleteTodos.map((todo, index) => (
            <TodoItemRow key={`${todo.content}-${index}`}>
              {getTodoStatusIcon(todo.status)}
              <TodoContent>{todo.status === 'in_progress' ? todo.activeForm : todo.content}</TodoContent>
              <TodoStatus>{t(getStatusTranslationKey(todo.status))}</TodoStatus>
            </TodoItemRow>
          ))}
        </TodoList>
      </PanelBody>
    </Container>
  )
}

const Container = styled.div`
  position: relative;
  z-index: 1;
  padding: 0 18px 8px;
`

const PanelBody = styled.div`
  border-radius: 8px;
  border: 0.5px solid var(--color-border);
  overflow: hidden;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background-color: rgba(240, 240, 240, 0.5);
    backdrop-filter: blur(35px) saturate(150%);
    z-index: -1;
    border-radius: inherit;

    body[theme-mode='dark'] & {
      background-color: rgba(40, 40, 40, 0.4);
    }
  }
`

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-2);

  &:hover {
    background-color: var(--color-background-soft);
  }
`

const HeaderTitle = styled.span`
  font-weight: 500;
`

const TodoList = styled.div<{ $collapsed: boolean }>`
  max-height: ${(props) => (props.$collapsed ? '0px' : '200px')};
  overflow-y: auto;
  transition: max-height 0.2s ease;
`

const TodoItemRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  border-top: 0.5px solid var(--color-border);
`

const TodoContent = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const TodoStatus = styled.span`
  font-size: 11px;
  color: var(--color-text-3);
`
