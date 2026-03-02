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
  setSearchQuery,
  updateTask as updateTaskAction
} from '@renderer/store/tasks'
import { executeTask as executeTaskThunk, loadTasksFromStorage, updateTask } from '@renderer/store/tasksThunk'
import type { PeriodicTask, TaskExecution } from '@types'
import type { MenuProps } from 'antd'
import { Dropdown } from 'antd'
import { CheckCircle, CirclePlus, Clock, Pause, Play, Search, Settings, Sparkles, X, XCircle } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(tasks[0]?.id)
  const [selectedExecution, setSelectedExecution] = useState<TaskExecution | undefined>(undefined)
  const [isDragging] = useState(false)

  // Get the selected task from Redux store (always up-to-date)
  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedTaskId), [tasks, selectedTaskId])

  // Popup states
  const [editPopupOpen, setEditPopupOpen] = useState(false)
  const [editMode, setEditMode] = useState<'create' | 'edit'>('create')

  const handleCreateTask = useCallback(async () => {
    setEditMode('create')
    setSelectedTaskId(undefined)
    setEditPopupOpen(true)
  }, [])

  const handleRunTask = async (taskId: string) => {
    try {
      const execution = await dispatch(executeTaskThunk(taskId) as any)

      // Show toast based on execution result
      if (execution?.status === 'completed' && execution?.result?.success) {
        window.toast.success('任务执行完成')
      } else if (execution?.status === 'failed') {
        window.toast.error(`任务执行失败: ${execution.result?.error}`)
      } else {
        window.toast.info('任务已开始执行')
      }
    } catch (error) {
      logger.error('Failed to execute task:', error as Error)
      window.toast.error('任务执行失败')
    }
  }

  // Update selected task when tasks change
  useEffect(() => {
    const hasSelectedTask = tasks.find((task) => task.id === selectedTaskId)
    !hasSelectedTask && setSelectedTaskId(tasks[0]?.id)
  }, [tasks, selectedTaskId])

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
            setSelectedTaskId(task.id)
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
                setSelectedTaskId(undefined)
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
            <SearchWrapper>
              <SearchIconWrapper>
                <Search size={14} />
              </SearchIconWrapper>
              <SearchInput
                placeholder={t('tasks.search_placeholder') || '搜索任务...'}
                value={tasksState.searchQuery}
                onChange={(e) => dispatch(setSearchQuery(e.target.value))}
              />
              {tasksState.searchQuery && (
                <ClearSearchButton onClick={() => dispatch(setSearchQuery(''))}>
                  <X size={14} />
                </ClearSearchButton>
              )}
            </SearchWrapper>
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
                    onClick={() => setSelectedTaskId(task.id)}
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
            <EmptyStateContainer>
              <EmptyStateIcon>
                <Sparkles size={48} />
              </EmptyStateIcon>
              <EmptyStateTitle>{t('tasks.empty')}</EmptyStateTitle>
              <EmptyStateDescription>
                任务可以帮你自动化日常工作，定时或手动触发 AI 助手执行特定任务。
              </EmptyStateDescription>
              <EmptyStateFeatures>
                <FeatureItem>
                  <FeatureIcon>📅</FeatureIcon>
                  <FeatureText>定时调度</FeatureText>
                </FeatureItem>
                <FeatureItem>
                  <FeatureIcon>🤖</FeatureIcon>
                  <FeatureText>AI 助手</FeatureText>
                </FeatureItem>
                <FeatureItem>
                  <FeatureIcon>📊</FeatureIcon>
                  <FeatureText>执行追踪</FeatureText>
                </FeatureItem>
              </EmptyStateFeatures>
              <CreateTaskButton onClick={handleCreateTask}>
                <CirclePlus size={18} />
                {t('tasks.create')}
              </CreateTaskButton>
            </EmptyStateContainer>
          </MainContent>
        ) : selectedTask ? (
          <TaskContent>
            <TaskDetailPanel
              task={selectedTask}
              selectedExecution={selectedExecution}
              onExecutionSelect={setSelectedExecution}
              onClose={() => setSelectedExecution(undefined)}
              onEdit={() => {
                setEditMode('edit')
                setEditPopupOpen(true)
              }}
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

const EmptyStateContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 40px;
  text-align: center;
`

const EmptyStateIcon = styled.div`
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--color-primary-bg);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
`

const EmptyStateTitle = styled.h2`
  font-size: 18px;
  font-weight: 500;
  color: var(--color-text-1);
  margin: 0 0 12px 0;
`

const EmptyStateDescription = styled.p`
  font-size: 13px;
  color: var(--color-text-2);
  max-width: 400px;
  line-height: 1.6;
  margin: 0 0 32px 0;
`

const EmptyStateFeatures = styled.div`
  display: flex;
  gap: 32px;
  margin-bottom: 32px;
`

const FeatureItem = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
`

const FeatureIcon = styled.div`
  font-size: 24px;
`

const FeatureText = styled.span`
  font-size: 12px;
  color: var(--color-text-2);
`

const CreateTaskButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--color-primary-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  &:active {
    transform: translateY(0);
  }
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

const SearchWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--color-background);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  border: 0.5px solid var(--color-border);
  transition: all 0.2s;

  &:focus-within {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-bg);
  }
`

const SearchIconWrapper = styled.div`
  display: flex;
  align-items: center;
  color: var(--color-text-2);
  flex-shrink: 0;
`

const SearchInput = styled.input`
  flex: 1;
  border: none;
  background: transparent;
  font-size: 13px;
  color: var(--color-text-1);
  outline: none;
  padding: 0;

  &::placeholder {
    color: var(--color-text-3);
  }
`

const ClearSearchButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-2);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  padding: 2px;
  transition: all 0.2s;

  &:hover {
    background: var(--color-hover-background);
    color: var(--color-text-1);
  }
`

const FilterGroup = styled.div`
  display: flex;
  gap: 8px;
  background: var(--color-background);
  border-radius: 8px;
  padding: 4px;
`

const FilterButton = styled.button<{ $active: boolean }>`
  flex: 1;
  height: 30px;
  border: none;
  background: transparent;
  color: ${(props) => (props.$active ? 'var(--color-text)' : 'var(--color-text-secondary)')};
  font-size: 13px;
  font-weight: ${(props) => (props.$active ? '600' : '400')};
  cursor: pointer;
  border-radius: 8px;
  margin: 0 2px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;

  &:hover {
    color: var(--color-text);
  }

  &:active {
    transform: scale(0.98);
  }

  &::after {
    content: '';
    position: absolute;
    bottom: -7px;
    left: 50%;
    transform: translateX(-50%);
    width: ${(props) => (props.$active ? '30px' : '0')};
    height: 3px;
    background: var(--color-primary);
    border-radius: 1px;
    transition: all 0.2s ease;
  }

  &:hover::after {
    width: ${(props) => (props.$active ? '30px' : '16px')};
    background: ${(props) => (props.$active ? 'var(--color-primary)' : 'var(--color-primary-soft)')};
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
