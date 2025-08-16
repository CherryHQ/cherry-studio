import App from '@renderer/components/MinApp/MinApp'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import tabsService from '@renderer/services/TabsService'
import { FileSearch, Folder, Languages, LayoutGrid, NotepadText, Palette, Sparkle } from 'lucide-react'
import { FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

const LaunchpadPage: FC = () => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { defaultPaintingProvider } = useSettings()
  const { pinned } = useMinapps()
  const { openedKeepAliveMinapps } = useRuntime()

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
      text: t('title.agents'),
      path: '/agents',
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
      icon: <NotepadText size={32} className="icon" />,
      text: t('title.notes'),
      path: '/notes',
      bgColor: 'linear-gradient(135deg, #F97316, #FB923C)' // 笔记：橙色，代表活力和清晰思路
    }
  ]

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
                  <App app={app} size={56} onClick={() => setTimeout(() => tabsService.closeTab('launchpad'), 350)} />
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

export default LaunchpadPage
