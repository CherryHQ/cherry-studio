import App from '@renderer/components/MiniApp/MiniApp'
import { getSidebarMenuPath, SIDEBAR_ICON_COMPONENTS, SIDEBAR_ICON_ORDER } from '@renderer/config/sidebar'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTabs } from '@renderer/hooks/useTabs'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type GlobalSearchLaunchpadProps = {
  defaultPaintingProvider?: string
  onClose?: () => void
}

const APP_ICON_BACKGROUNDS: Record<SidebarIcon, string> = {
  assistants: 'linear-gradient(135deg, #111827, #4B5563)',
  agents: 'linear-gradient(135deg, #2563EB, #38BDF8)',
  store: 'linear-gradient(135deg, #0EA5E9, #6366F1)',
  paintings: 'linear-gradient(135deg, #EC4899, #F472B6)',
  translate: 'linear-gradient(135deg, #06B6D4, #0EA5E9)',
  mini_app: 'linear-gradient(135deg, #8B5CF6, #A855F7)',
  knowledge: 'linear-gradient(135deg, #10B981, #34D399)',
  files: 'linear-gradient(135deg, #F59E0B, #FBBF24)',
  code_tools: 'linear-gradient(135deg, #1F2937, #374151)',
  notes: 'linear-gradient(135deg, #F97316, #FB923C)',
  openclaw: 'linear-gradient(135deg, #EF4444, #B91C1C)'
}

export const GlobalSearchLaunchpad: FC<GlobalSearchLaunchpadProps> = ({
  defaultPaintingProvider: defaultPaintingProviderProp,
  onClose
}) => {
  const { t } = useTranslation()
  const { defaultPaintingProvider } = useSettings()
  const { openTab } = useTabs()
  const { pinned, openedKeepAliveMiniApps } = useMiniApps()
  const paintingProvider = defaultPaintingProviderProp ?? defaultPaintingProvider
  const openLaunchpadItem = (path: string, title: string) => {
    openTab(path, { forceNew: true, title })
    onClose?.()
  }

  const appMenuItems = SIDEBAR_ICON_ORDER.flatMap((icon) => {
    const Icon = SIDEBAR_ICON_COMPONENTS[icon]
    const path = getSidebarMenuPath(icon, paintingProvider)
    if (!Icon || !path) return []

    return [
      {
        icon: <Icon size={32} className="icon" />,
        text: getSidebarIconLabel(icon),
        path,
        bgColor: APP_ICON_BACKGROUNDS[icon]
      }
    ]
  })

  // 合并并排序小程序列表
  const sortedMiniApps = useMemo(() => {
    // 先添加固定的小程序，保持原有顺序
    const result = [...pinned]

    // 再添加其他已打开但未固定的小程序
    openedKeepAliveMiniApps.forEach((app) => {
      if (!result.some((pinnedApp) => pinnedApp.appId === app.appId)) {
        result.push(app)
      }
    })

    return result
  }, [openedKeepAliveMiniApps, pinned])

  return (
    <Container>
      <Content>
        <Section>
          <SectionTitle>{t('launchpad.apps')}</SectionTitle>
          <Grid>
            {appMenuItems.map((item) => (
              <AppIcon key={item.path} onClick={() => openLaunchpadItem(item.path, item.text)}>
                <IconContainer>
                  <IconWrapper $bgColor={item.bgColor}>{item.icon}</IconWrapper>
                </IconContainer>
                <AppName>{item.text}</AppName>
              </AppIcon>
            ))}
          </Grid>
        </Section>

        {sortedMiniApps.length > 0 && (
          <Section>
            <SectionTitle>{t('launchpad.miniApps')}</SectionTitle>
            <Grid>
              {sortedMiniApps.map((app) => (
                <AppWrapper key={app.appId}>
                  <App app={app} size={56} onClick={onClose} />
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
  padding: 8px 20px 20px;
`

const Content = styled.div`
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
  color: var(--color-foreground);
  opacity: 0.8;
  margin: 0;
  padding: 0;
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

const IconWrapper = styled.div<{ $bgColor: string }>`
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: ${(props) => props.$bgColor};
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
  color: var(--color-foreground);
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

export default GlobalSearchLaunchpad
