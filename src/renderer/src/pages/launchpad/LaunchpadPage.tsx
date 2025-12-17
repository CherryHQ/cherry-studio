import { OpenClawIcon } from '@renderer/components/Icons/SVGIcon'
import AssistantAvatar from '@renderer/components/Avatar/AssistantAvatar'
import App from '@renderer/components/MinApp/MinApp'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setLaunchpadAssistantId, setLaunchpadTopicId } from '@renderer/store/settings'
import { sortTopicsByPinnedAndCreatedAt } from '@renderer/utils/topicSort'
import type { MenuProps } from 'antd'
import { Dropdown } from 'antd'
import {
  Check,
  ChevronDown,
  Code,
  FileSearch,
  Folder,
  Languages,
  LayoutGrid,
  MessageSquare,
  NotepadText,
  Palette,
  Sparkle
} from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

const LaunchpadPage: FC = () => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { defaultPaintingProvider, launchpadAssistantId, launchpadTopicId } = useSettings()
  const { pinned } = useMinapps()
  const { assistants } = useAssistants()
  const { chat, openedKeepAliveMinapps } = useRuntime()
  const dispatch = useAppDispatch()
  const activeTopic = chat.activeTopic

  const appMenuItems = [
    {
      icon: <LayoutGrid size={32} className="icon" />,
      text: t('title.apps'),
      path: '/apps',
      bgColor: 'linear-gradient(135deg, #8B5CF6, #A855F7)' // 小程序：紫色，代表多功能和灵活性
    },
    {
      icon: <FileSearch size={32} className="icon" />,
      text: t('title.knowledge'),
      path: '/knowledge',
      bgColor: 'linear-gradient(135deg, #10B981, #34D399)' // 知识库：翠绿色，代表生长和知识
    },
    {
      icon: <Palette size={32} className="icon" />,
      text: t('title.paintings'),
      path: `/paintings/${defaultPaintingProvider}`,
      bgColor: 'linear-gradient(135deg, #EC4899, #F472B6)' // 绘画：活力粉色，代表创造力和艺术
    },
    {
      icon: <Sparkle size={32} className="icon" />,
      text: t('title.store'),
      path: '/store',
      bgColor: 'linear-gradient(135deg, #6366F1, #4F46E5)' // AI助手：靛蓝渐变，代表智能和科技
    },
    {
      icon: <Languages size={32} className="icon" />,
      text: t('title.translate'),
      path: '/translate',
      bgColor: 'linear-gradient(135deg, #06B6D4, #0EA5E9)' // 翻译：明亮的青蓝色，代表沟通和流畅
    },
    {
      icon: <Folder size={32} className="icon" />,
      text: t('title.files'),
      path: '/files',
      bgColor: 'linear-gradient(135deg, #F59E0B, #FBBF24)' // 文件：金色，代表资源和重要性
    },
    {
      icon: <Code size={32} className="icon" />,
      text: t('title.code'),
      path: '/code',
      bgColor: 'linear-gradient(135deg, #1F2937, #374151)' // Code CLI：高级暗黑色，代表专业和技术
    },
    {
      icon: <OpenClawIcon className="icon" />,
      text: t('title.openclaw'),
      path: '/openclaw',
      bgColor: 'linear-gradient(135deg, #EF4444, #B91C1C)' // OpenClaw：红色渐变，代表龙虾的颜色
    },
    {
      icon: <NotepadText size={32} className="icon" />,
      text: t('title.notes'),
      path: '/notes',
      bgColor: 'linear-gradient(135deg, #F97316, #FB923C)' // 笔记：橙色，代表活力和清晰思路
    }
  ]

  const selectedAssistant = useMemo(() => {
    if (assistants.length === 0) return null
    const storedAssistant = assistants.find((assistant) => assistant.id === launchpadAssistantId)
    if (storedAssistant) return storedAssistant
    const activeAssistant = activeTopic
      ? assistants.find((assistant) => assistant.id === activeTopic.assistantId)
      : null
    return activeAssistant || assistants[0]
  }, [assistants, launchpadAssistantId, activeTopic])

  const assistantTopics = useMemo(() => {
    if (!selectedAssistant) return []
    return sortTopicsByPinnedAndCreatedAt(selectedAssistant.topics || [])
  }, [selectedAssistant])

  const selectedTopic = useMemo(() => {
    if (!selectedAssistant) return null
    const storedTopic = assistantTopics.find((topic) => topic.id === launchpadTopicId)
    if (storedTopic) return storedTopic
    if (activeTopic && activeTopic.assistantId === selectedAssistant.id) {
      const activeTopicInAssistant = assistantTopics.find((topic) => topic.id === activeTopic.id)
      if (activeTopicInAssistant) return activeTopicInAssistant
    }
    return assistantTopics[0] || null
  }, [assistantTopics, launchpadTopicId, activeTopic, selectedAssistant])

  const selectedAssistantId = selectedAssistant?.id
  const selectedTopicId = selectedTopic?.id

  useEffect(() => {
    if (!selectedAssistantId) return
    if (selectedAssistantId !== launchpadAssistantId) {
      dispatch(setLaunchpadAssistantId(selectedAssistantId))
    }
  }, [dispatch, selectedAssistantId, launchpadAssistantId])

  useEffect(() => {
    if (!selectedTopicId) return
    if (selectedTopicId !== launchpadTopicId) {
      dispatch(setLaunchpadTopicId(selectedTopicId))
    }
  }, [dispatch, selectedTopicId, launchpadTopicId])

  const handleAssistantSelect = useCallback(
    (assistantId: string) => {
      const nextAssistant = assistants.find((assistant) => assistant.id === assistantId)
      if (!nextAssistant) return

      const nextTopics = sortTopicsByPinnedAndCreatedAt(nextAssistant.topics || [])
      const nextTopicId =
        nextTopics.find((topic) => topic.id === launchpadTopicId)?.id ||
        (activeTopic?.assistantId === nextAssistant.id ? activeTopic.id : undefined) ||
        nextTopics[0]?.id ||
        ''

      dispatch(setLaunchpadAssistantId(assistantId))
      dispatch(setLaunchpadTopicId(nextTopicId))
      navigate(`/chat/assistant/${assistantId}`)
    },
    [assistants, dispatch, navigate, launchpadTopicId, activeTopic]
  )

  const handleTopicSelect = useCallback(
    (topicId: string) => {
      if (!selectedAssistant) return
      dispatch(setLaunchpadAssistantId(selectedAssistant.id))
      dispatch(setLaunchpadTopicId(topicId))
      navigate(`/chat/topic/${topicId}`)
    },
    [dispatch, navigate, selectedAssistant]
  )

  const assistantMenuItems = useMemo<MenuProps['items']>(
    () =>
      assistants.map((assistant) => ({
        key: assistant.id,
        icon: assistant.id === selectedAssistant?.id ? <CheckIcon /> : undefined,
        label: (
          <MenuItemRow>
            <AssistantAvatar assistant={assistant} size={18} />
            <MenuItemName>{assistant.name || t('chat.default.name')}</MenuItemName>
          </MenuItemRow>
        ),
        onClick: () => handleAssistantSelect(assistant.id)
      })),
    [assistants, handleAssistantSelect, selectedAssistant?.id, t]
  )

  const topicMenuItems = useMemo<MenuProps['items']>(
    () =>
      assistantTopics.map((topic) => ({
        key: topic.id,
        icon: topic.id === selectedTopic?.id ? <CheckIcon /> : <MessageSquare size={14} />,
        label: (
          <MenuItemRow>
            <MessageSquare size={14} />
            <MenuItemName>{topic.name}</MenuItemName>
          </MenuItemRow>
        ),
        onClick: () => handleTopicSelect(topic.id)
      })),
    [assistantTopics, handleTopicSelect, selectedTopic?.id]
  )

  // 合并并排序小程序列表
  const sortedMinapps = useMemo(() => {
    // 先添加固定的小程序，保持原有顺序
    const result = [...pinned]

    // 再添加其他已打开但未固定的小程序
    openedKeepAliveMinapps.forEach((app) => {
      if (!result.some((pinnedApp) => pinnedApp.id === app.id)) {
        result.push(app)
      }
    })

    return result
  }, [openedKeepAliveMinapps, pinned])

  return (
    <Container>
      <Content>
        <Section>
          <SectionTitle>{t('launchpad.apps')}</SectionTitle>
          <Grid>
            <SelectableAppIcon
              label={selectedAssistant?.name || t('launchpad.assistant')}
              icon={
                <SoftIconWrapper>
                  {selectedAssistant ? <AssistantAvatar assistant={selectedAssistant} size={28} /> : null}
                </SoftIconWrapper>
              }
              menuItems={assistantMenuItems}
              onClick={() => selectedAssistant && navigate(`/chat/assistant/${selectedAssistant.id}`)}
            />
            <SelectableAppIcon
              label={selectedTopic?.name || t('launchpad.topic')}
              icon={
                <SoftIconWrapper>
                  <MessageSquare size={28} />
                </SoftIconWrapper>
              }
              menuItems={topicMenuItems}
              onClick={() => selectedTopic && navigate(`/chat/topic/${selectedTopic.id}`)}
            />
            {appMenuItems.map((item) => (
              <AppIcon key={item.path} onClick={() => navigate(item.path)}>
                <IconContainer>
                  <IconWrapper bgColor={item.bgColor}>{item.icon}</IconWrapper>
                </IconContainer>
                <AppName>{item.text}</AppName>
              </AppIcon>
            ))}
          </Grid>
        </Section>

        {sortedMinapps.length > 0 && (
          <Section>
            <SectionTitle>{t('launchpad.minapps')}</SectionTitle>
            <Grid>
              {sortedMinapps.map((app) => (
                <AppWrapper key={app.id}>
                  <App app={app} size={56} />
                </AppWrapper>
              ))}
            </Grid>
          </Section>
        )}
      </Content>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background-color: var(--color-background);
  overflow-y: auto;
  padding: 50px 0;
`

const Content = styled.div`
  max-width: 720px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionTitle = styled.h2`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  opacity: 0.8;
  margin: 0;
  padding: 0 36px;
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
  padding: 0 8px;
`

const AppIcon = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  gap: 4px;
  padding: 8px 4px;
  border-radius: 16px;
  transition: transform 0.2s ease;

  &:hover {
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }
`

const IconContainer = styled.div`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 56px;
  height: 56px;
`

const SoftIconWrapper = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--color-text);
`

const IconWrapper = styled.div<{ bgColor: string }>`
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: ${(props) => props.bgColor};
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

  .icon {
    color: white;
    width: 28px;
    height: 28px;
  }
`

const AppName = styled.div`
  font-size: 12px;
  color: var(--color-text);
  text-align: center;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const AppWrapper = styled.div`
  padding: 8px 4px;
  border-radius: 8px;
  transition: transform 0.2s ease;

  &:hover {
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }
`

const SelectableAppIcon: FC<{
  icon: ReactNode
  label: string
  menuItems: MenuProps['items']
  onClick: () => void
}> = ({ icon, label, menuItems, onClick }) => {
  return (
    <AppIcon onClick={onClick}>
      <IconContainer>
        {icon}
        <Dropdown menu={{ items: menuItems }} trigger={['click']}>
          <MenuTrigger type="button" aria-label={label} onClick={(event) => event.stopPropagation()}>
            <ChevronDown size={12} />
          </MenuTrigger>
        </Dropdown>
      </IconContainer>
      <AppName>{label}</AppName>
    </AppIcon>
  )
}

const MenuTrigger = styled.button`
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 20px;
  height: 20px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 0;

  &:hover {
    color: var(--color-text);
  }
`

const MenuItemRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const MenuItemName = styled.span`
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const CheckIcon = styled(Check)`
  width: 14px;
  height: 14px;
`

export default LaunchpadPage
