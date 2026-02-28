/**
 * Periodic Tasks Manager Page
 * Grid view similar to MinApps for managing scheduled tasks
 */

import { loggerService } from '@logger'
import { Navbar, NavbarMain } from '@renderer/components/app/Navbar'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addExecution,
  getFilteredTasks,
  getTaskListItems,
  selectTasks,
  setFilter,
  updateTask as updateTaskAction
} from '@renderer/store/tasks'
import { executeTask as executeTaskThunk, loadTasksFromStorage } from '@renderer/store/tasksThunk'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import TaskCard from './components/TaskCard'
import TaskDetailPopup from './components/TaskDetailPopup'
import TaskEditPopup from './components/TaskEditPopup'

const logger = loggerService.withContext('TasksPage')

const TasksPage: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const tasksState = useAppSelector(selectTasks)
  const tasks = useAppSelector(getFilteredTasks)
  const taskListItems = useAppSelector(getTaskListItems)

  // Popup states
  const [detailPopupOpen, setDetailPopupOpen] = useState(false)
  const [editPopupOpen, setEditPopupOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined)
  const [editMode, setEditMode] = useState<'create' | 'edit'>('create')

  // Calculate grid layout
  const itemsPerRow = Math.floor(930 / 140)
  const rowCount = Math.ceil((tasks.length + 1) / itemsPerRow)
  const containerHeight = rowCount * 110 + (rowCount - 1) * 25

  const handleTaskClick = (taskId: string) => {
    setSelectedTaskId(taskId)
    setDetailPopupOpen(true)
  }

  const handleCreateTask = () => {
    setEditMode('create')
    setSelectedTaskId(undefined)
    setEditPopupOpen(true)
  }

  const handleEditTask = () => {
    setDetailPopupOpen(false)
    setEditMode('edit')
    setEditPopupOpen(true)
  }

  const handleCloseDetail = () => {
    setDetailPopupOpen(false)
    setSelectedTaskId(undefined)
  }

  const handleCloseEdit = () => {
    setEditPopupOpen(false)
    setSelectedTaskId(undefined)
  }

  // Load tasks from main process on mount
  useEffect(() => {
    dispatch(loadTasksFromStorage() as any)
  }, [dispatch])

  // Set up task execution listener from main process
  useEffect(() => {
    let cleanup: (() => void) | undefined
    let isMounted = true

    const setupListener = async () => {
      const { setupTaskExecutionListener } = await import('@renderer/services/TaskExecutionService')
      if (isMounted) {
        cleanup = setupTaskExecutionListener()
      }
    }

    setupListener()

    return () => {
      isMounted = false
      cleanup?.()
    }
  }, [])

  const handleRunTask = async (taskId: string) => {
    try {
      await dispatch(executeTaskThunk(taskId) as any)
      window.toast.success('任务已开始执行')
    } catch (error) {
      logger.error('Failed to execute task:', error as Error)
      window.toast.error('任务执行失败')
    }
  }

  // Listen for task execution events
  useEffect(() => {
    const cleanupStarted = window.api.task.onExecutionStarted(({ taskId, executionId }) => {
      // Execution already added when executeNow is called, this is just for background tasks
      logger.info('任务执行已开始：', { taskId, executionId })
    })

    const cleanupCompleted = window.api.task.onExecutionCompleted(({ taskId, execution }) => {
      dispatch(addExecution({ taskId, execution }))
      dispatch(
        updateTaskAction({
          ...tasks.find((t) => t.id === taskId)!,
          lastRunAt: execution.completedAt,
          totalRuns: (tasks.find((t) => t.id === taskId)?.totalRuns || 0) + 1
        })
      )
      if (execution.result?.success) {
        window.toast.success('任务执行完成')
      }
    })

    const cleanupFailed = window.api.task.onExecutionFailed(({ taskId, execution }) => {
      dispatch(addExecution({ taskId, execution }))
      window.toast.error(`任务执行失败: ${execution.result?.error}`)
    })

    return () => {
      cleanupStarted()
      cleanupCompleted()
      cleanupFailed()
    }
  }, [tasks])

  return (
    <Container>
      <Navbar>
        <NavbarMain>
          {t('tasks.title')}
          <FilterGroup>
            <FilterButton $active={tasksState.filter === 'all'} onClick={() => dispatch(setFilter('all'))}>
              {t('tasks.filter.all')}
            </FilterButton>
            <FilterButton $active={tasksState.filter === 'enabled'} onClick={() => dispatch(setFilter('enabled'))}>
              {t('tasks.filter.enabled')}
            </FilterButton>
            <FilterButton $active={tasksState.filter === 'disabled'} onClick={() => dispatch(setFilter('disabled'))}>
              {t('tasks.filter.disabled')}
            </FilterButton>
          </FilterGroup>
        </NavbarMain>
      </Navbar>
      <ContentContainer>
        <TasksContainer style={{ height: containerHeight }}>
          {tasks.map((task) => {
            const listItem = taskListItems.find((item) => item.id === task.id)
            if (!listItem) return null
            return (
              <TaskCard key={task.id} task={task} listItem={listItem} onClick={handleTaskClick} onRun={handleRunTask} />
            )
          })}
          <AddTaskCard onClick={handleCreateTask}>
            <AddIcon>+</AddIcon>
            <AddText>{t('tasks.create')}</AddText>
          </AddTaskCard>
        </TasksContainer>
      </ContentContainer>

      {/* Detail Popup */}
      {selectedTaskId && (
        <TaskDetailPopup
          open={detailPopupOpen}
          taskId={selectedTaskId}
          onClose={handleCloseDetail}
          onEdit={handleEditTask}
          onRun={handleRunTask}
        />
      )}

      {/* Edit Popup */}
      <TaskEditPopup open={editPopupOpen} mode={editMode} taskId={selectedTaskId} onClose={handleCloseEdit} />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  justify-content: center;
  height: 100%;
`

const TasksContainer = styled.div`
  display: grid;
  min-width: 0;
  max-width: 930px;
  margin: 50px 20px 20px;
  width: 100%;
  grid-template-columns: repeat(auto-fill, 115px);
  gap: 25px;
  justify-content: center;
`

const FilterGroup = styled.div`
  display: flex;
  gap: 8px;
  background: var(--color-background);
  border-radius: 8px;
  padding: 4px;
`

const FilterButton = styled.button<{ $active: boolean }>`
  border: none;
  background: transparent;
  color: ${(props) => (props.$active ? 'var(--color-primary)' : 'var(--color-text-2)')};
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;

  &:hover {
    background: var(--color-hover-background);
  }

  &:active {
    transform: scale(0.95);
  }
`

const AddTaskCard = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 115px;
  height: 85px;
  border: 2px dashed var(--color-border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--color-primary);
    background: var(--color-hover-background);
  }
`

const AddIcon = styled.div`
  font-size: 32px;
  color: var(--color-text-2);
  line-height: 1;
`

const AddText = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  margin-top: 8px;
`

export default TasksPage
