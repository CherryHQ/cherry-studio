import { Button, Sortable } from '@cherrystudio/ui'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import App from '@renderer/components/MiniApp/MiniApp'
import Scrollbar from '@renderer/components/Scrollbar'
import {
  getDefaultSidebarIconPreferences,
  getRequiredSidebarIconsVisible,
  getSidebarMenuPath,
  REQUIRED_SIDEBAR_ICONS,
  sanitizeSidebarIcons,
  SIDEBAR_ICON_COMPONENTS,
  SIDEBAR_ICON_ORDER
} from '@renderer/config/sidebar'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTabs } from '@renderer/hooks/useTabs'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import { ArrowLeft, Eye, EyeOff, GripVertical, RotateCcw } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
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

const SIDEBAR_ICON_PREFERENCE_KEYS = {
  visible: 'ui.sidebar.icons.visible',
  invisible: 'ui.sidebar.icons.invisible'
} as const

type GlobalSearchQuickAppManagerItem = {
  icon: SidebarIcon
  label: string
  visible: boolean
}

function getPreferenceOrderedSidebarIcons(
  visibleIcons: readonly SidebarIcon[] | undefined,
  invisibleIcons: readonly SidebarIcon[] | undefined
) {
  const orderedIcons: SidebarIcon[] = []
  const seen = new Set<SidebarIcon>()

  const addIcons = (icons: readonly SidebarIcon[] | undefined) => {
    for (const icon of sanitizeSidebarIcons(icons)) {
      if (seen.has(icon)) continue
      orderedIcons.push(icon)
      seen.add(icon)
    }
  }

  addIcons(visibleIcons)
  addIcons(invisibleIcons)
  addIcons(SIDEBAR_ICON_ORDER)

  return orderedIcons
}

function getSidebarIconPreferencesFromOrderedIcons({
  orderedIcons,
  visibleIcons
}: {
  orderedIcons: readonly SidebarIcon[]
  visibleIcons: ReadonlySet<SidebarIcon>
}) {
  const requiredIcons = new Set(REQUIRED_SIDEBAR_ICONS)
  const normalizedOrder = getPreferenceOrderedSidebarIcons(orderedIcons, undefined)

  return {
    visible: normalizedOrder.filter((icon) => visibleIcons.has(icon) || requiredIcons.has(icon)),
    invisible: normalizedOrder.filter((icon) => !visibleIcons.has(icon) && !requiredIcons.has(icon))
  }
}

function moveSidebarIcon(icons: readonly SidebarIcon[], oldIndex: number, newIndex: number) {
  if (oldIndex === newIndex || oldIndex < 0 || newIndex < 0 || oldIndex >= icons.length || newIndex >= icons.length) {
    return icons
  }

  const nextIcons = [...icons]
  const [movedIcon] = nextIcons.splice(oldIndex, 1)
  if (!movedIcon) return icons

  nextIcons.splice(newIndex, 0, movedIcon)
  return nextIcons
}

export const GlobalSearchLaunchpad: FC<GlobalSearchLaunchpadProps> = ({
  defaultPaintingProvider: defaultPaintingProviderProp,
  onClose
}) => {
  const { t } = useTranslation()
  const { defaultPaintingProvider } = useSettings()
  const { openTab } = useTabs()
  const { pinned, openedKeepAliveMiniApps } = useMiniApps()
  const [isManaging, setIsManaging] = useState(false)
  const [sidebarIconPreferences, setSidebarIconPreferences] = useMultiplePreferences(SIDEBAR_ICON_PREFERENCE_KEYS)
  const paintingProvider = defaultPaintingProviderProp ?? defaultPaintingProvider
  const visibleIconSet = useMemo(
    () => new Set(getRequiredSidebarIconsVisible(sidebarIconPreferences.visible)),
    [sidebarIconPreferences.visible]
  )
  const sidebarPreferenceManagerIcons = useMemo(
    () => getPreferenceOrderedSidebarIcons(sidebarIconPreferences.visible, sidebarIconPreferences.invisible),
    [sidebarIconPreferences.invisible, sidebarIconPreferences.visible]
  )
  const openLaunchpadItem = (path: string, title: string) => {
    openTab(path, { forceNew: true, title })
    onClose?.()
  }

  const saveSidebarIconPreferences = async (preferences: { visible: SidebarIcon[]; invisible: SidebarIcon[] }) => {
    try {
      await setSidebarIconPreferences(preferences)
    } catch {
      window.toast?.error(t('globalSearch.quickApps.save_failed'))
    }
  }

  const handleSidebarManagerVisibilityChange = (icon: SidebarIcon, nextVisible: boolean) => {
    const nextVisibleIconSet = new Set(visibleIconSet)

    if (nextVisible) {
      nextVisibleIconSet.add(icon)
    } else if (!REQUIRED_SIDEBAR_ICONS.includes(icon)) {
      nextVisibleIconSet.delete(icon)
    }

    void saveSidebarIconPreferences(
      getSidebarIconPreferencesFromOrderedIcons({
        orderedIcons: sidebarPreferenceManagerIcons,
        visibleIcons: nextVisibleIconSet
      })
    )
  }

  const handleSidebarManagerReorder = ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
    const orderedIcons = moveSidebarIcon(sidebarPreferenceManagerIcons, oldIndex, newIndex)
    if (orderedIcons === sidebarPreferenceManagerIcons) return

    void saveSidebarIconPreferences(
      getSidebarIconPreferencesFromOrderedIcons({
        orderedIcons,
        visibleIcons: visibleIconSet
      })
    )
  }

  const resetSidebarIcons = async () => {
    try {
      await setSidebarIconPreferences(getDefaultSidebarIconPreferences())
    } catch {
      window.toast?.error(t('globalSearch.quickApps.save_failed'))
    }
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
      {isManaging ? (
        <GlobalSearchQuickAppManager
          icons={sidebarPreferenceManagerIcons}
          visibleIcons={visibleIconSet}
          onBack={() => setIsManaging(false)}
          onReorder={handleSidebarManagerReorder}
          onReset={() => void resetSidebarIcons()}
          onVisibilityChange={handleSidebarManagerVisibilityChange}
        />
      ) : (
        <LaunchpadScroll>
          <Content>
            <Section>
              <SectionHeader>
                <SectionTitle>{t('launchpad.apps')}</SectionTitle>
                <SectionActions>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsManaging(true)}
                    className="h-7 rounded-[8px] px-2 font-medium text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground">
                    {t('globalSearch.quickApps.manage')}
                  </Button>
                </SectionActions>
              </SectionHeader>
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
        </LaunchpadScroll>
      )}
    </Container>
  )
}

function GlobalSearchQuickAppManager({
  icons,
  onBack,
  onReorder,
  onReset,
  onVisibilityChange,
  visibleIcons
}: {
  icons: SidebarIcon[]
  onBack: () => void
  onReorder: (event: { oldIndex: number; newIndex: number }) => void
  onReset: () => void
  onVisibilityChange: (icon: SidebarIcon, visible: boolean) => void
  visibleIcons: ReadonlySet<SidebarIcon>
}) {
  const { t } = useTranslation()
  const items = useMemo<GlobalSearchQuickAppManagerItem[]>(
    () =>
      icons.map((icon) => ({
        icon,
        label: getSidebarIconLabel(icon),
        visible: visibleIcons.has(icon)
      })),
    [icons, visibleIcons]
  )

  return (
    <ManagerPanel>
      <ManagerHeader>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('common.back')}
          onClick={onBack}
          className="size-8 shrink-0 rounded-[8px] p-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
          <ArrowLeft className="size-4" />
        </Button>
        <ManagerTitleRow>
          <SectionTitle>{t('globalSearch.quickApps.manager_title')}</SectionTitle>
          <ManagerDescription>{t('globalSearch.quickApps.manager_description')}</ManagerDescription>
        </ManagerTitleRow>
        <SectionActions>
          <Button
            type="button"
            variant="ghost"
            onClick={onReset}
            className="h-8 shrink-0 gap-1.5 rounded-[8px] px-2 text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground">
            <RotateCcw className="size-3.5" />
            <span>{t('globalSearch.quickApps.reset')}</span>
          </Button>
        </SectionActions>
      </ManagerHeader>

      <ManagerList data-testid="quick-app-manager-list">
        <Sortable
          items={items}
          itemKey="icon"
          onSortEnd={onReorder}
          gap={4}
          restrictions={{ scrollableAncestor: true }}
          showGhost
          renderItem={(item, { dragging }) => (
            <GlobalSearchQuickAppManagerRow item={item} dragging={dragging} onVisibilityChange={onVisibilityChange} />
          )}
        />
      </ManagerList>
    </ManagerPanel>
  )
}

function GlobalSearchQuickAppManagerRow({
  dragging,
  item,
  onVisibilityChange
}: {
  dragging: boolean
  item: GlobalSearchQuickAppManagerItem
  onVisibilityChange: (icon: SidebarIcon, visible: boolean) => void
}) {
  const { t } = useTranslation()
  const Icon = SIDEBAR_ICON_COMPONENTS[item.icon]
  const isRequired = REQUIRED_SIDEBAR_ICONS.includes(item.icon)
  const nextVisible = !item.visible

  return (
    <ManagerItem $dragging={dragging} $visible={item.visible}>
      <GripVertical className="size-4 shrink-0 text-muted-foreground/60" />
      <ManagerItemIcon>
        <Icon className="size-4" />
      </ManagerItemIcon>
      <ManagerItemName>{item.label}</ManagerItemName>
      <Button
        type="button"
        variant="ghost"
        disabled={isRequired}
        aria-label={t(item.visible ? 'globalSearch.quickApps.hide' : 'globalSearch.quickApps.show', {
          name: item.label
        })}
        aria-pressed={item.visible}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onVisibilityChange(item.icon, nextVisible)}
        className="size-8 shrink-0 rounded-[8px] p-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
        {item.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </Button>
    </ManagerItem>
  )
}
const Container = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: var(--color-background);
`

const LaunchpadScroll = styled(Scrollbar)`
  width: 100%;
  min-height: 0;
  flex: 1;
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

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const SectionActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
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

const ManagerPanel = styled.div`
  display: flex;
  height: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`

const ManagerHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--color-border-subtle);
`

const ManagerTitleRow = styled.div`
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: baseline;
  gap: 8px;
`

const ManagerList = styled(Scrollbar)`
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 16px 12px;
`

const ManagerDescription = styled.div`
  color: var(--color-foreground-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ManagerItem = styled.div<{ $dragging: boolean; $visible: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  border-radius: 12px;
  padding: 0 12px;
  color: ${(props) => (props.$visible ? 'var(--color-foreground)' : 'var(--color-foreground-muted)')};
  opacity: ${(props) => (props.$visible ? 1 : 0.6)};
  transition:
    background-color 0.2s ease,
    box-shadow 0.2s ease;
  background: ${(props) => (props.$dragging ? 'var(--color-muted)' : 'transparent')};
  box-shadow: ${(props) => (props.$dragging ? 'var(--shadow-sm)' : 'none')};

  &:hover {
    background: var(--color-muted);
  }
`

const ManagerItemIcon = styled.div`
  display: flex;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: var(--color-muted);
  color: var(--color-foreground-muted);
`

const ManagerItemName = styled.div`
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  font-size: 14px;
`

export default GlobalSearchLaunchpad
