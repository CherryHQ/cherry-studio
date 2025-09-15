import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CodeOutlined,
  ExportOutlined,
  LinkOutlined,
  MinusOutlined,
  PushpinOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { isDev } from '@renderer/config/constant'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setMinappsOpenLinkExternal } from '@renderer/store/settings'
import { MinAppType } from '@renderer/types'
import { Tooltip } from 'antd'
import { WebviewTag } from 'electron'
import { FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

interface Props {
  app: MinAppType
  webviewRef: React.RefObject<WebviewTag | null>
  currentUrl: string | null
  onReload: () => void
  onOpenDevTools: () => void
}

const MinimalToolbar: FC<Props> = ({ app, webviewRef, currentUrl, onReload, onOpenDevTools }) => {
  const { t } = useTranslation()
  const { pinned, updatePinnedMinapps } = useMinapps()
  const { minappsOpenLinkExternal } = useSettings()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const canPinned = DEFAULT_MIN_APPS.some((item) => item.id === app.id)
  const isPinned = pinned.some((item) => item.id === app.id)
  const canOpenExternalLink = app.url.startsWith('http://') || app.url.startsWith('https://')

  // Update navigation state
  const updateNavigationState = useCallback(() => {
    if (webviewRef.current) {
      setCanGoBack(webviewRef.current.canGoBack())
      setCanGoForward(webviewRef.current.canGoForward())
    }
  }, [webviewRef])

  const handleGoBack = useCallback(() => {
    if (webviewRef.current && webviewRef.current.canGoBack()) {
      webviewRef.current.goBack()
      updateNavigationState()
    }
  }, [webviewRef, updateNavigationState])

  const handleGoForward = useCallback(() => {
    if (webviewRef.current && webviewRef.current.canGoForward()) {
      webviewRef.current.goForward()
      updateNavigationState()
    }
  }, [webviewRef, updateNavigationState])

  const handleMinimize = useCallback(() => {
    navigate('/apps')
  }, [navigate])

  const handleTogglePin = useCallback(() => {
    const newPinned = isPinned ? pinned.filter((item) => item.id !== app.id) : [...pinned, app]
    updatePinnedMinapps(newPinned)
  }, [app, isPinned, pinned, updatePinnedMinapps])

  const handleToggleOpenExternal = useCallback(() => {
    dispatch(setMinappsOpenLinkExternal(!minappsOpenLinkExternal))
  }, [dispatch, minappsOpenLinkExternal])

  const handleOpenLink = useCallback(() => {
    const urlToOpen = currentUrl || app.url
    window.api.openWebsite(urlToOpen)
  }, [currentUrl, app.url])

  return (
    <ToolbarContainer>
      <LeftSection>
        <ButtonGroup>
          <Tooltip title={t('minapp.popup.goBack')} placement="bottom">
            <ToolbarButton onClick={handleGoBack} $disabled={!canGoBack}>
              <ArrowLeftOutlined />
            </ToolbarButton>
          </Tooltip>

          <Tooltip title={t('minapp.popup.goForward')} placement="bottom">
            <ToolbarButton onClick={handleGoForward} $disabled={!canGoForward}>
              <ArrowRightOutlined />
            </ToolbarButton>
          </Tooltip>

          <Tooltip title={t('minapp.popup.refresh')} placement="bottom">
            <ToolbarButton onClick={onReload}>
              <ReloadOutlined />
            </ToolbarButton>
          </Tooltip>
        </ButtonGroup>
      </LeftSection>

      <RightSection>
        <ButtonGroup>
          {canOpenExternalLink && (
            <Tooltip title={t('minapp.popup.openExternal')} placement="bottom">
              <ToolbarButton onClick={handleOpenLink}>
                <ExportOutlined />
              </ToolbarButton>
            </Tooltip>
          )}

          {canPinned && (
            <Tooltip
              title={isPinned ? t('minapp.remove_from_launchpad') : t('minapp.add_to_launchpad')}
              placement="bottom">
              <ToolbarButton onClick={handleTogglePin} $active={isPinned}>
                <PushpinOutlined />
              </ToolbarButton>
            </Tooltip>
          )}

          <Tooltip
            title={
              minappsOpenLinkExternal
                ? t('minapp.popup.open_link_external_on')
                : t('minapp.popup.open_link_external_off')
            }
            placement="bottom">
            <ToolbarButton onClick={handleToggleOpenExternal} $active={minappsOpenLinkExternal}>
              <LinkOutlined />
            </ToolbarButton>
          </Tooltip>

          {isDev && (
            <Tooltip title={t('minapp.popup.devtools')} placement="bottom">
              <ToolbarButton onClick={onOpenDevTools}>
                <CodeOutlined />
              </ToolbarButton>
            </Tooltip>
          )}

          <Tooltip title={t('minapp.popup.minimize')} placement="bottom">
            <ToolbarButton onClick={handleMinimize}>
              <MinusOutlined />
            </ToolbarButton>
          </Tooltip>
        </ButtonGroup>
      </RightSection>
    </ToolbarContainer>
  )
}

const ToolbarContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 35px;
  padding: 0 12px;
  background-color: var(--color-background);
  flex-shrink: 0;
`

const LeftSection = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const RightSection = styled.div`
  display: flex;
  align-items: center;
`

const ButtonGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
`

const ToolbarButton = styled.button<{
  $disabled?: boolean
  $active?: boolean
}>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: ${({ $active }) => ($active ? 'var(--color-primary-bg)' : 'transparent')};
  color: ${({ $disabled, $active }) =>
    $disabled ? 'var(--color-text-3)' : $active ? 'var(--color-primary)' : 'var(--color-text-2)'};
  cursor: ${({ $disabled }) => ($disabled ? 'default' : 'pointer')};
  transition: all 0.2s ease;
  font-size: 12px;

  &:hover {
    background: ${({ $disabled, $active }) =>
      $disabled ? 'transparent' : $active ? 'var(--color-primary-bg)' : 'var(--color-background-soft)'};
    color: ${({ $disabled, $active }) =>
      $disabled ? 'var(--color-text-3)' : $active ? 'var(--color-primary)' : 'var(--color-text-1)'};
  }

  &:active {
    transform: ${({ $disabled }) => ($disabled ? 'none' : 'scale(0.95)')};
  }
`

export default MinimalToolbar
