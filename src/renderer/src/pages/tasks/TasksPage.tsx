/**
 * Periodic Tasks Manager Page
 * Grid view similar to MinApps for managing scheduled tasks
 */

import { Navbar, NavbarMain } from '@renderer/components/app/Navbar'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { getFilteredTasks, getTaskListItems, selectTasks, setFilter } from '@renderer/store/tasks'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import TaskCard from './components/TaskCard'
import TaskDetailPopup from './components/TaskDetailPopup'
import TaskEditPopup from './components/TaskEditPopup'

const TasksPage: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const tasksState = useAppSelector(selectTasks)
  const tasks = useAppSelector(getFilteredTasks)
  const taskListItems = useAppSelector(getTaskListItems)

  // Calculate grid layout
  const itemsPerRow = Math.floor(930 / 140)
  const rowCount = Math.ceil((tasks.length + 1) / itemsPerRow)
  const containerHeight = rowCount * 110 + (rowCount - 1) * 25

  const handleTaskClick = (taskId: string) => {
    TaskDetailPopup.show({ taskId })
  }

  const handleCreateTask = () => {
    TaskEditPopup.show({ mode: 'create' })
  }

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
            return <TaskCard key={task.id} task={task} listItem={listItem!} onClick={handleTaskClick} />
          })}
          <AddTaskCard onClick={handleCreateTask}>
            <AddIcon>+</AddIcon>
            <AddText>{t('tasks.create')}</AddText>
          </AddTaskCard>
        </TasksContainer>
      </ContentContainer>
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
