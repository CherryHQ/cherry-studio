import chatVideoLight from '@renderer/assets/images/guide/chat.mp4'
import chatVideoDark from '@renderer/assets/images/guide/chat_dark.mp4'
import configureProviderLight from '@renderer/assets/images/guide/Configure_Provider_step0.mp4'
import configureProviderDark from '@renderer/assets/images/guide/Configure_Provider_step0_dark.mp4'
import freeModelGif from '@renderer/assets/images/guide/free_model.gif'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import LazyMedia from './LazyMedia'

type TaskKey = 'useFreeModel' | 'configureProvider' | 'sendFirstMessage'

interface TaskPopoverContentProps {
  taskKey: TaskKey
  onConfirm: () => void
}

interface MediaContent {
  type: 'image' | 'video'
  light: string
  dark?: string
}

interface TaskContent {
  titleKey: string
  features: string[]
  buttonKey: string
  media?: MediaContent
}

const TASK_CONTENT: Record<TaskKey, TaskContent> = {
  useFreeModel: {
    titleKey: 'userGuide.taskPopover.useFreeModel.title',
    features: [
      'userGuide.taskPopover.useFreeModel.features.noRegistration',
      'userGuide.taskPopover.useFreeModel.features.fastResponse',
      'userGuide.taskPopover.useFreeModel.features.allInOne'
    ],
    buttonKey: 'userGuide.taskPopover.useFreeModel.button',
    media: {
      type: 'image',
      light: freeModelGif
    }
  },
  configureProvider: {
    titleKey: 'userGuide.taskPopover.configureProvider.title',
    features: [
      'userGuide.taskPopover.configureProvider.features.unlockModels',
      'userGuide.taskPopover.configureProvider.features.privacyFirst',
      'userGuide.taskPopover.configureProvider.features.localModels'
    ],
    buttonKey: 'userGuide.taskPopover.configureProvider.button',
    media: {
      type: 'video',
      light: configureProviderLight,
      dark: configureProviderDark
    }
  },
  sendFirstMessage: {
    titleKey: 'userGuide.taskPopover.sendFirstMessage.title',
    features: [
      'userGuide.taskPopover.sendFirstMessage.features.markdown',
      'userGuide.taskPopover.sendFirstMessage.features.typewriter',
      'userGuide.taskPopover.sendFirstMessage.features.fileAnalysis'
    ],
    buttonKey: 'userGuide.taskPopover.sendFirstMessage.button',
    media: {
      type: 'video',
      light: chatVideoLight,
      dark: chatVideoDark
    }
  }
}

const TaskPopoverContent: FC<TaskPopoverContentProps> = ({ taskKey, onConfirm }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const content = TASK_CONTENT[taskKey]
  const isDark = theme === 'dark'

  const renderMedia = () => {
    if (!content.media) return null

    const mediaSrc = isDark && content.media.dark ? content.media.dark : content.media.light

    return (
      <MediaContainer>
        <LazyMedia type={content.media.type} src={mediaSrc} />
      </MediaContainer>
    )
  }

  return (
    <PopoverContainer>
      <PopoverTitle>{t(content.titleKey)}</PopoverTitle>

      {renderMedia()}

      <FeatureList>
        {content.features.map((featureKey, index) => (
          <FeatureItem key={index}>{t(featureKey)}</FeatureItem>
        ))}
      </FeatureList>

      <ButtonContainer>
        <ConfirmButton onClick={onConfirm}>{t(content.buttonKey)}</ConfirmButton>
      </ButtonContainer>
    </PopoverContainer>
  )
}

const PopoverContainer = styled.div`
  width: 280px;
  padding: 4px;
`

const PopoverTitle = styled.h3`
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 12px 0;
  line-height: 16px;
`

const MediaContainer = styled.div`
  margin-bottom: 12px;
`

const FeatureList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
`

const FeatureItem = styled.p`
  margin: 0;
  color: var(--color-text-2);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
`

const ButtonContainer = styled.div`
  display: flex;
  justify-content: flex-end;
`

const ConfirmButton = styled.button`
  min-width: 80px;
  padding: 6px 12px;
  background-color: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    opacity: 0.9;
  }
`

export default TaskPopoverContent
