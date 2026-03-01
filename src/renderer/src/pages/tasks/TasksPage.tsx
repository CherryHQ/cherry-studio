/**
 * Periodic Tasks Manager Page
 * Sidebar + Main Content + Right Detail Panel layout
 */

import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import ListItem from '@renderer/components/ListItem'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  deleteTask,
  getFilteredTasks,
  selectTasks,
  setFilter,
  updateTask as updateTaskAction
} from '@renderer/store/tasks'
import { executeTask as executeTaskThunk, loadTasksFromStorage, updateTask } from '@renderer/store/tasksThunk'
import type { PeriodicTask, TaskExecution } from '@types'
import type { MenuProps } from 'antd'
import { Dropdown, Empty } from 'antd'
import { CheckCircle, CirclePlus, Clock, Pause, Play, Settings, X, XCircle } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import TaskDetailPanel from './components/TaskDetailPanel'
import TaskEditPopup from './components/TaskEditPopup'

const logger = loggerService.withContext('TasksPage')

const TasksPage: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const tasksState = useAppSelector(selectTasks)
  const tasks = useAppSelector(getFilteredTasks)
  const [selectedTask, setSelectedTask] = useState<PeriodicTask | undefined>(tasks[0])
  const [selectedExecution, setSelectedExecution] = useState<TaskExecution | undefined>(undefined)
  const [isDragging] = useState(false)

  // Popup states
  const [editPopupOpen, setEditPopupOpen] = useState(false)
  const [editMode, setEditMode] = useState<'create' | 'edit'>('create')

  const handleCreateTask = useCallback(async () => {
    setEditMode('create')
    setSelectedTask(undefined)
    setEditPopupOpen(true)
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

  // Update selected task when tasks change
  useEffect(() => {
    const hasSelectedTask = tasks.find((task) => task.id === selectedTask?.id)
    !hasSelectedTask && setSelectedTask(tasks[0])
  }, [tasks, selectedTask])

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

  const getMenuItems = useCallback(
    (task: PeriodicTask): MenuProps['items'] => {
      const menus: MenuProps['items'] = [
        {
          label: t('common.rename'),
          key: 'rename',
          icon: <EditIcon size={14} />,
          async onClick() {
            const name = await PromptPopup.show({
              title: t('tasks.rename'),
              message: '',
              defaultValue: task.name || ''
            })
            if (name && task.name !== name) {
              dispatch(updateTask({ ...task, name }))
            }
          }
        },
        {
          label: t('tasks.edit'),
          key: 'edit',
          icon: <Settings size={14} />,
          onClick: () => {
            setSelectedTask(task)
            setEditMode('edit')
            setEditPopupOpen(true)
          }
        },
        { type: 'divider' },
        {
          label: t('common.delete'),
          danger: true,
          key: 'delete',
          icon: <DeleteIcon size={14} className="lucide-custom" />,
          onClick: () => {
            window.modal.confirm({
              title: t('tasks.delete_confirm'),
              centered: true,
              onOk: () => {
                setSelectedTask(undefined)
                setSelectedExecution(undefined)
                dispatch(deleteTask(task.id))
              }
            })
          }
        }
      ]

      return menus
    },
    [deleteTask, dispatch, t]
  )

  // Listen for task execution events
  useEffect(() => {
    const cleanupCompleted = window.api.task.onExecutionCompleted(({ taskId, execution }) => {
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

    const cleanupFailed = window.api.task.onExecutionFailed(({ execution }) => {
      window.toast.error(`任务执行失败: ${execution.result?.error}`)
    })

    return () => {
      cleanupCompleted()
      cleanupFailed()
    }
  }, [dispatch, tasks, updateTaskAction])

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('tasks.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <TaskSideNav>
          <FilterSection>
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
          </FilterSection>

          <TaskList>
            {tasks.map((task) => (
              <Dropdown menu={{ items: getMenuItems(task) }} trigger={['contextMenu']} key={task.id}>
                <div style={{ position: 'relative' }}>
                  <ListItem
                    active={selectedTask?.id === task.id}
                    icon={<TaskEmoji>{task.emoji || '📝'}</TaskEmoji>}
                    title={task.name}
                    onClick={() => setSelectedTask(task)}
                  />
                  <PlayIconWrapper
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRunTask(task.id)
                    }}>
                    <Play size={14} />
                  </PlayIconWrapper>
                </div>
              </Dropdown>
            ))}
          </TaskList>

          {!isDragging && (
            <AddTaskItem onClick={handleCreateTask}>
              <AddTaskName>
                <CirclePlus size={18} />
                {t('tasks.create')}
              </AddTaskName>
            </AddTaskItem>
          )}
          <div style={{ minHeight: '10px' }}></div>
        </TaskSideNav>

        {tasks.length === 0 ? (
          <MainContent>
            <Empty description={t('tasks.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </MainContent>
        ) : selectedTask ? (
          <TaskContent>
            <TaskDetailPanel
              task={selectedTask}
              selectedExecution={selectedExecution}
              onExecutionSelect={setSelectedExecution}
              onClose={() => setSelectedExecution(undefined)}
            />
          </TaskContent>
        ) : null}

        {/* Right Detail Panel - Fixed width */}
        {selectedExecution && (
          <ExecutionDetailPanel>
            <DetailPanelHeader>
              <DetailPanelTitle>执行详情</DetailPanelTitle>
              <CloseDetailButton onClick={() => setSelectedExecution(undefined)}>
                <X size={16} />
              </CloseDetailButton>
            </DetailPanelHeader>
            <DetailPanelContent>
              <DetailSection>
                <DetailLabel>执行 ID</DetailLabel>
                <DetailValue>{selectedExecution.id}</DetailValue>
              </DetailSection>
              <DetailSection>
                <DetailLabel>开始时间</DetailLabel>
                <DetailValue>{new Date(selectedExecution.startedAt).toLocaleString('zh-CN')}</DetailValue>
              </DetailSection>
              {selectedExecution.completedAt && (
                <DetailSection>
                  <DetailLabel>完成时间</DetailLabel>
                  <DetailValue>{new Date(selectedExecution.completedAt).toLocaleString('zh-CN')}</DetailValue>
                </DetailSection>
              )}
              <DetailSection>
                <DetailLabel>状态</DetailLabel>
                <DetailValue>
                  <StatusChip status={selectedExecution.status}>
                    {selectedExecution.status === 'completed' && <CheckCircle size={12} />}
                    {selectedExecution.status === 'failed' && <XCircle size={12} />}
                    {selectedExecution.status === 'running' && <Clock size={12} />}
                    {selectedExecution.status === 'paused' && <Pause size={12} />}
                    {selectedExecution.status === 'completed' && '成功'}
                    {selectedExecution.status === 'failed' && '失败'}
                    {selectedExecution.status === 'running' && '运行中'}
                    {selectedExecution.status === 'paused' && '暂停'}
                  </StatusChip>
                </DetailValue>
              </DetailSection>
              {selectedExecution.completedAt && (
                <DetailSection>
                  <DetailLabel>耗时</DetailLabel>
                  <DetailValue>
                    {Math.round(
                      (new Date(selectedExecution.completedAt).getTime() -
                        new Date(selectedExecution.startedAt).getTime()) /
                        1000
                    )}{' '}
                    秒
                  </DetailValue>
                </DetailSection>
              )}
              {selectedExecution.result && (
                <>
                  <DetailSection>
                    <DetailLabel>执行结果</DetailLabel>
                    <DetailValue>
                      {selectedExecution.result.success ? (
                        <SuccessText>✓ 成功</SuccessText>
                      ) : (
                        <ErrorText>✗ 失败</ErrorText>
                      )}
                    </DetailValue>
                  </DetailSection>
                  {selectedExecution.result.output && (
                    <DetailSection>
                      <DetailLabel>输出内容</DetailLabel>
                      <OutputPreview>{selectedExecution.result.output}</OutputPreview>
                    </DetailSection>
                  )}
                  {selectedExecution.result.error && (
                    <DetailSection>
                      <DetailLabel>错误信息</DetailLabel>
                      <ErrorText>{selectedExecution.result.error}</ErrorText>
                    </DetailSection>
                  )}
                </>
              )}
              {selectedExecution.status === 'running' && (
                <DetailSection>
                  <DetailLabel>当前状态</DetailLabel>
                  <RunningStatus>
                    <Spinner />
                    任务正在执行中...
                  </RunningStatus>
                </DetailSection>
              )}
            </DetailPanelContent>
          </ExecutionDetailPanel>
        )}
      </ContentContainer>

      {/* Edit Popup */}
      <TaskEditPopup
        open={editPopupOpen}
        mode={editMode}
        taskId={selectedTask?.id}
        onClose={() => setEditPopupOpen(false)}
      />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height));
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  min-height: 100%;
  position: relative;
`

const MainContent = styled(Scrollbar)`
  padding: 15px 20px;
  display: flex;
  width: 100%;
  flex-direction: column;
  padding-bottom: 50px;
`

const TaskSideNav = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  width: calc(var(--settings-width) + 100px);
  border-right: 0.5px solid var(--color-border);
  padding: 12px 10px;
  flex-shrink: 0;
`

const FilterSection = styled.div`
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 0.5px solid var(--color-border);
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
  flex: 1;

  &:hover {
    background: var(--color-hover-background);
  }

  &:active {
    transform: scale(0.95);
  }
`

const TaskList = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const AddTaskItem = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 7px 12px;
  position: relative;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid transparent;
  cursor: pointer;

  &:hover {
    background-color: var(--color-background-soft);
  }
`

const AddTaskName = styled.div`
  color: var(--color-text);
  display: flex;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`

const TaskEmoji = styled.span`
  font-size: 16px;
  line-height: 1;
`

const PlayIconWrapper = styled.button`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--color-text-2);
  transition: all 0.2s;
  background: transparent;
  border: none;
  cursor: pointer;

  &:hover {
    background: var(--color-primary-bg);
    color: var(--color-primary);
  }
`

const TaskContent = styled(Scrollbar)`
  flex: 1;
  padding: 16px;
  overflow-y: auto;
`

// Right Execution Detail Panel
const ExecutionDetailPanel = styled.div`
  width: 320px;
  border-left: 0.5px solid var(--color-border);
  background: var(--color-background);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 10;
`

const DetailPanelHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 0.5px solid var(--color-border);
  background: var(--color-background-soft);
  height: 44px;
`

const DetailPanelTitle = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
`

const CloseDetailButton = styled.button`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-2);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--color-hover-background);
    color: var(--color-text-1);
  }
`

const DetailPanelContent = styled.div`
  flex: 1;
  padding: 12px 16px;
  overflow-y: auto;
`

const DetailSection = styled.div`
  margin-bottom: 12px;

  &:last-child {
    margin-bottom: 0;
  }
`

const DetailLabel = styled.div`
  font-size: 11px;
  color: var(--color-text-2);
  margin-bottom: 4px;
`

const DetailValue = styled.div`
  font-size: 12px;
  color: var(--color-text-1);
  word-break: break-word;
`

const OutputPreview = styled.pre`
  padding: 8px;
  background: var(--color-background-soft);
  border-radius: 6px;
  font-size: 11px;
  color: var(--color-text-1);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  max-height: 150px;
  overflow-y: auto;
`

const StatusChip = styled.div<{ status: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;

  &[status="completed"] {
    background: var(--color-success-bg);
    color: var(--color-success);
  }

  &[status="failed"] {
    background: var(--color-error-bg);
    color: var(--color-error);
  }

  &[status="running"] {
    background: var(--color-primary-bg);
    color: var(--color-primary);
  }

  &[status="paused"] {
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }
`

const SuccessText = styled.span`
  color: var(--color-success);
  font-size: 12px;
`

const ErrorText = styled.span`
  color: var(--color-error);
  font-size: 12px;
  word-break: break-word;
`

const RunningStatus = styled.div`
  font-size: 12px;
  color: var(--color-primary);
  display: flex;
  align-items: center;
  gap: 8px;
`

const Spinner = styled.span`
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-radius: 50%;
  border-top-color: transparent;
  animation: spin 0.8s linear infinite;
  opacity: 0.7;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`

export default TasksPage
