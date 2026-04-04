import { loggerService } from '@logger'
import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import IndicatorLight from '@renderer/components/IndicatorLight'
import MarqueeText from '@renderer/components/MarqueeText'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import type { MiniApp } from '@shared/data/types/miniapp'
import { useNavigate } from '@tanstack/react-router'
import type { MenuProps } from 'antd'
import { Dropdown } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  app: MiniApp
  onClick?: () => void
  size?: number
  isLast?: boolean
}

const logger = loggerService.withContext('App')

const MinApp: FC<Props> = ({ app, onClick, size = 60, isLast }) => {
  const { openMinappKeepAlive } = useMinappPopup()
  const { t } = useTranslation()
  const {
    minapps,
    pinned,
    disabled,
    openedKeepAliveMinapps,
    currentMinappId,
    minappShow,
    setOpenedKeepAliveMinapps,
    updateMinapps,
    updateDisabledMinapps,
    updatePinnedMinapps,
    removeCustomMiniapp
  } = useMinapps()
  const navigate = useNavigate()
  const isPinned = pinned.some((p) => p.appId === app.appId)
  const isVisible = minapps.some((m) => m.appId === app.appId)
  // Pinned apps should always be visible regardless of region/locale filtering
  const shouldShow = isVisible || isPinned
  const isActive = minappShow && currentMinappId === app.appId
  const isOpened = openedKeepAliveMinapps.some((item) => item.appId === app.appId)
  const { isTopNavbar } = useNavbarPosition()

  // Calculate display name
  const displayName = isLast ? t('settings.miniapps.custom.title') : app.nameKey ? t(app.nameKey) : app.name

  const handleClick = () => {
    if (isTopNavbar) {
      // 顶部导航栏：导航到小程序页面
      void navigate({ to: '/app/minapp/$appId', params: { appId: app.appId } })
    } else {
      // 侧边导航栏：保持原有弹窗行为
      openMinappKeepAlive(app)
    }
    onClick?.()
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'togglePin',
      label: isPinned
        ? isTopNavbar
          ? t('minapp.remove_from_launchpad')
          : t('minapp.remove_from_sidebar')
        : isTopNavbar
          ? t('minapp.add_to_launchpad')
          : t('minapp.add_to_sidebar'),
      onClick: () => {
        const newPinned = isPinned ? pinned.filter((item) => item.appId !== app.appId) : [...pinned, app]
        updatePinnedMinapps(newPinned)
      }
    },
    {
      key: 'hide',
      label: t('minapp.sidebar.hide.title'),
      onClick: () => {
        const newMinapps = minapps.filter((item) => item.appId !== app.appId)
        updateMinapps(newMinapps)
        const newDisabled = [...(disabled || []), app]
        updateDisabledMinapps(newDisabled)
        updatePinnedMinapps(pinned.filter((item) => item.appId !== app.appId))
        // 更新 openedKeepAliveMinapps
        const newOpenedKeepAliveMinapps = openedKeepAliveMinapps.filter((item) => item.appId !== app.appId)
        setOpenedKeepAliveMinapps(newOpenedKeepAliveMinapps)
      }
    },
    ...(app.type === 'custom'
      ? [
          {
            key: 'removeCustom',
            label: t('minapp.sidebar.remove_custom.title'),
            danger: true,
            onClick: async () => {
              try {
                await removeCustomMiniapp(app.appId)
                window.toast.success(t('settings.miniapps.custom.remove_success'))
              } catch (error) {
                window.toast.error(t('settings.miniapps.custom.remove_error'))
                logger.error('Failed to remove custom mini app:', error as Error)
              }
            }
          }
        ]
      : [])
  ]

  if (!shouldShow) {
    return null
  }

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
      <Container onClick={handleClick}>
        <IconContainer>
          <MinAppIcon size={size} app={app} />
          {isOpened && (
            <StyledIndicator>
              <IndicatorLight color="#22c55e" size={6} animation={!isActive} />
            </StyledIndicator>
          )}
        </IconContainer>
        <AppTitle>
          <MarqueeText>{displayName}</MarqueeText>
        </AppTitle>
      </Container>
    </Dropdown>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
  min-height: 85px;
`

const IconContainer = styled.div`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
`

const StyledIndicator = styled.div`
  position: absolute;
  bottom: -2px;
  right: -2px;
  padding: 2px;
  background: var(--color-background);
  border-radius: 50%;
`

const AppTitle = styled.div`
  font-size: 12px;
  margin-top: 5px;
  color: var(--color-text-soft);
  text-align: center;
  user-select: none;
  width: 100%;
  max-width: 80px;
`

export default MinApp
