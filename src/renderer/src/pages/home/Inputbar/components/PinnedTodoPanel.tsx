/**
 * V2 TodoWrite progress panel — derives the latest incomplete todo list
 * directly from the message parts rather than Redux message-blocks.
 *
 * Unlike V1, this panel does not offer a "dismiss" (delete) affordance:
 * parts are authoritative history in V2, so the panel simply hides once
 * all todos complete and collapses on header click otherwise.
 */

import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { Typography } from 'antd'
import { CheckCircle, ChevronDown, ChevronUp, Circle, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { TodoItem, TodoWriteToolInput } from '../../Messages/Tools/MessageAgentTools/types'

const { Text } = Typography

interface ActiveTodos {
  todos: TodoItem[]
  activeTodo: TodoItem | undefined
  completedCount: number
  totalCount: number
}

const TODO_WRITE_TYPE = 'tool-TodoWrite'

function extractTodoWriteTodos(part: CherryMessagePart): TodoItem[] | undefined {
  if (part.type !== TODO_WRITE_TYPE) return undefined
  const input = (part as { input?: TodoWriteToolInput }).input
  const todos = input?.todos
  return Array.isArray(todos) ? todos : undefined
}

function selectActiveTodos(
  messages: Message[],
  partsMap: Record<string, CherryMessagePart[]>
): ActiveTodos | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = partsMap[messages[i].id]
    if (!parts?.length) continue
    for (let j = parts.length - 1; j >= 0; j--) {
      const todos = extractTodoWriteTodos(parts[j])
      if (!todos?.length) continue
      if (todos.every((todo) => todo.status === 'completed')) continue
      const activeTodo =
        todos.find((todo) => todo.status === 'in_progress') ?? todos.find((todo) => todo.status === 'pending')
      return {
        todos,
        activeTodo,
        completedCount: todos.filter((todo) => todo.status === 'completed').length,
        totalCount: todos.length
      }
    }
  }
  return undefined
}

const TodoStatusIcon: FC<{ status: TodoItem['status'] }> = ({ status }) => {
  switch (status) {
    case 'completed':
      return <CheckCircle size={14} className="text-green-500" />
    case 'in_progress':
      return <Loader2 size={14} className="animate-spin text-blue-500" />
    case 'pending':
    default:
      return <Circle size={14} className="text-gray-400" />
  }
}

interface PinnedTodoPanelProps {
  messages: Message[]
  partsMap: Record<string, CherryMessagePart[]>
}

export const PinnedTodoPanel: FC<PinnedTodoPanelProps> = ({ messages, partsMap }) => {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(true)

  const activeTodos = useMemo(() => selectActiveTodos(messages, partsMap), [messages, partsMap])

  if (!activeTodos) return null

  const { todos, activeTodo, completedCount, totalCount } = activeTodos

  return (
    <Container>
      <PanelBody>
        <PanelHeader onClick={() => setIsCollapsed(!isCollapsed)}>
          <HeaderLeft>
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            {isCollapsed && activeTodo ? (
              <>
                <TodoStatusIcon status={activeTodo.status} />
                <HeaderTitle>
                  {activeTodo.status === 'in_progress' ? activeTodo.activeForm : activeTodo.content}
                </HeaderTitle>
              </>
            ) : (
              <HeaderTitle>{t('agent.todo.panel.title', { completed: completedCount, total: totalCount })}</HeaderTitle>
            )}
          </HeaderLeft>
        </PanelHeader>
        <TodoList $collapsed={isCollapsed}>
          {todos.map((todo, index) => (
            <TodoItemRow key={`${todo.content}-${index}`} $completed={todo.status === 'completed'}>
              <TodoStatusIcon status={todo.status} />
              <TodoContent $completed={todo.status === 'completed'}>
                {todo.status === 'in_progress' ? todo.activeForm : todo.content}
              </TodoContent>
            </TodoItemRow>
          ))}
        </TodoList>
      </PanelBody>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
`

const PanelBody = styled.div`
  border-radius: 17px;
  border: 0.5px solid var(--color-border);
  overflow: hidden;
  background-color: var(--color-background-opacity);

  body[theme-mode='dark'] & {
    background-color: var(--color-background-mute);
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
`

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const HeaderTitle = styled(Text)`
  font-weight: 500;
  font-size: 12px;
`

const TodoList = styled.div<{ $collapsed: boolean }>`
  max-height: ${(props) => (props.$collapsed ? '0px' : '200px')};
  overflow-y: auto;
  transition: max-height 0.2s ease;
`

const TodoItemRow = styled.div<{ $completed: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  opacity: ${(props) => (props.$completed ? 0.6 : 1)};
`

const TodoContent = styled.span<{ $completed: boolean }>`
  flex: 1;
  text-decoration: ${(props) => (props.$completed ? 'line-through' : 'none')};
  color: var(--color-text-1);
`
