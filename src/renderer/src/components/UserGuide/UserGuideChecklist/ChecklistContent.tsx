import { useOnboarding } from '@renderer/components/Onboarding'
import {
  configureProviderGuideStep2,
  sendMessageGuideStep2,
  useFreeModelGuideStep2
} from '@renderer/config/onboarding/guides'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setChecklistVisible } from '@renderer/store/onboarding'
import { Popover } from 'antd'
import { X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import {
  ChecklistHeader,
  ChecklistSubtitle,
  ChecklistTitle,
  CloseButton,
  ContentContainer,
  ProgressText,
  Separator,
  TaskList,
  TitleSection
} from './styles'
import TaskItem from './TaskItem'
import TaskPopoverContent from './TaskPopoverContent'

type TaskKey = 'useFreeModel' | 'configureProvider' | 'sendFirstMessage'

const ChecklistContent: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { startGuide } = useOnboarding()

  const { taskStatus } = useAppSelector((state) => state.onboarding)

  const [activePopover, setActivePopover] = useState<TaskKey | null>(null)

  const tasks = useMemo(
    () => [
      {
        key: 'useFreeModel' as const,
        label: t('userGuide.checklist.tasks.useFreeModel'),
        completed: taskStatus.useFreeModel
      },
      {
        key: 'configureProvider' as const,
        label: t('userGuide.checklist.tasks.configureProvider'),
        completed: taskStatus.configureProvider
      },
      {
        key: 'sendFirstMessage' as const,
        label: t('userGuide.checklist.tasks.sendFirstMessage'),
        completed: taskStatus.sendFirstMessage
      }
    ],
    [taskStatus, t]
  )

  const completedCount = tasks.filter((task) => task.completed).length

  const handleClose = useCallback(() => {
    dispatch(setChecklistVisible(false))
  }, [dispatch])

  // Handle popover visibility change
  const handlePopoverOpenChange = useCallback(
    (taskKey: TaskKey, open: boolean) => {
      if (taskStatus[taskKey]) return
      setActivePopover(open ? taskKey : null)
    },
    [taskStatus]
  )

  // Start Driver.js guide after popover button is clicked
  const handlePopoverConfirm = useCallback(
    (taskKey: TaskKey) => {
      setActivePopover(null)
      dispatch(setChecklistVisible(false))

      switch (taskKey) {
        case 'useFreeModel':
          navigate('/')
          setTimeout(() => startGuide(useFreeModelGuideStep2), 300)
          break
        case 'configureProvider':
          navigate('/settings/provider')
          setTimeout(() => startGuide(configureProviderGuideStep2), 300)
          break
        case 'sendFirstMessage':
          navigate('/')
          setTimeout(() => startGuide(sendMessageGuideStep2), 300)
          break
      }
    },
    [navigate, startGuide, dispatch]
  )

  return (
    <ContentContainer>
      <ChecklistHeader>
        <TitleSection>
          <ChecklistTitle>{t('userGuide.checklist.title')}</ChecklistTitle>
          <ChecklistSubtitle>{t('userGuide.checklist.subtitle')}</ChecklistSubtitle>
        </TitleSection>
        <CloseButton onClick={handleClose}>
          <X size={16} />
        </CloseButton>
      </ChecklistHeader>
      <Separator />
      <TaskList>
        {tasks.map((task) => (
          <Popover
            key={task.key}
            content={<TaskPopoverContent taskKey={task.key} onConfirm={() => handlePopoverConfirm(task.key)} />}
            trigger="click"
            open={activePopover === task.key}
            onOpenChange={(open) => handlePopoverOpenChange(task.key, open)}
            placement="leftTop"
            arrow={false}
            align={{ offset: [-8, 0] }}>
            <div>
              <TaskItem label={task.label} completed={task.completed} />
            </div>
          </Popover>
        ))}
      </TaskList>
      <ProgressText>
        {t('userGuide.checklist.progress', { completed: completedCount, total: tasks.length })}
      </ProgressText>
    </ContentContainer>
  )
}

export default ChecklistContent
