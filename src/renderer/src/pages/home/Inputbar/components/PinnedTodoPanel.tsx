import { useAppDispatch } from '@renderer/store'
import { removeBlocksThunk } from '@renderer/store/thunk/messageThunk'
import { Typography } from 'antd'
import { CheckCircle, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { TodoItem } from '../../Messages/Tools/MessageAgentTools/types'
import { useActiveTodos } from '../hooks/useActiveTodos'

const { Text } = Typography

/**
 * Get the status icon for a todo item
 */
function getTodoStatusIcon(status: TodoItem['status']) {
  switch (status) {
    case 'completed':
      return <CheckCircle size={14} className="text-green-500" />
    case 'in_progress':
      return <Loader2 size={14} className="animate-spin text-blue-500" />
    case 'pending':
    default:
      return <Loader2 size={14} className="animate-spin text-gray-400" />
  }
}

interface PinnedTodoPanelProps {
  topicId: string
}

export const PinnedTodoPanel: FC<PinnedTodoPanelProps> = ({ topicId }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const activeTodoInfo = useActiveTodos(topicId)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (activeTodoInfo) {
        // Group by messageId for batch deletion
        const blocksByMessage = new Map<string, string[]>()
        for (const { blockId, messageId } of activeTodoInfo.allTodoWriteBlocks) {
          const blocks = blocksByMessage.get(messageId) || []
          blocks.push(blockId)
          blocksByMessage.set(messageId, blocks)
        }
        // Delete all TodoWrite blocks
        for (const [messageId, blockIds] of blocksByMessage) {
          dispatch(removeBlocksThunk(topicId, messageId, blockIds))
        }
      }
    },
    [dispatch, topicId, activeTodoInfo]
  )

  if (!activeTodoInfo) {
    return null
  }

  const { todos, completedCount, totalCount } = activeTodoInfo

  return (
    <Container>
      <PanelBody>
        <PanelHeader onClick={() => setIsCollapsed(!isCollapsed)}>
          <HeaderLeft>
            {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <HeaderTitle>{t('agent.todo.panel.title', { completed: completedCount, total: totalCount })}</HeaderTitle>
          </HeaderLeft>
          <CloseButton onClick={handleClose}>
            <X size={14} />
          </CloseButton>
        </PanelHeader>
        <TodoList $collapsed={isCollapsed}>
          {todos.map((todo, index) => (
            <TodoItemRow key={`${todo.content}-${index}`} $completed={todo.status === 'completed'}>
              {getTodoStatusIcon(todo.status)}
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
  position: absolute;
  top: 0;
  left: 18px;
  right: 18px;
  transform: translateY(-100%);
  padding-bottom: 8px;
  z-index: 0;
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

const CloseButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-3);
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-1);
    background-color: var(--color-fill-2);
  }
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
  padding: 8px 12px;
  font-size: 13px;
  border-top: 0.5px solid var(--color-border);
  opacity: ${(props) => (props.$completed ? 0.6 : 1)};
`

const TodoContent = styled.span<{ $completed: boolean }>`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-decoration: ${(props) => (props.$completed ? 'line-through' : 'none')};
`
