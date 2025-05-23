import { useSelectionAssistant } from '@renderer/hooks/useSelectionAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { defaultLanguage } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { Button, Slider, Tooltip } from 'antd'
import { Droplet, Minus, Pin, X } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ActionGeneral from './components/ActionGeneral'
import ActionTranslate from './components/ActionTranslate'

const SelectionActionApp: FC = () => {
  const { language } = useSettings()

  const { t } = useTranslation()

  const [action, setAction] = useState<ActionItem | null>(null)
  const isActionLoaded = useRef(false)

  const { isAutoClose, isAutoPin, actionWindowOpacity } = useSelectionAssistant()
  const [isPinned, setIsPinned] = useState(isAutoPin)
  const [isWindowFocus, setIsWindowFocus] = useState(true)

  const [showOpacitySlider, setShowOpacitySlider] = useState(false)
  const [opacity, setOpacity] = useState(actionWindowOpacity)

  const contentElementRef = useRef<HTMLDivElement>(null)
  const isAutoScrollEnabled = useRef(true)
  const shouldCloseWhenBlur = useRef(false)

  useEffect(() => {
    if (isAutoPin) {
      window.api.selection.pinActionWindow(true)
    }

    const actionListenRemover = window.electron?.ipcRenderer.on(
      IpcChannel.Selection_UpdateActionData,
      (_, actionItem: ActionItem) => {
        setAction(actionItem)
        isActionLoaded.current = true
      }
    )

    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      actionListenRemover()
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('blur', handleWindowBlur)
    }
    // don't need any dependencies
  }, [])

  useEffect(() => {
    i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language])

  useEffect(() => {
    const contentEl = contentElementRef.current
    if (contentEl) {
      contentEl.addEventListener('scroll', handleUserScroll)
    }
    return () => {
      if (contentEl) {
        contentEl.removeEventListener('scroll', handleUserScroll)
      }
    }
    //we should rely on action to trigger this effect,
    // because the contentRef is not available when action is initially null
  }, [action])

  useEffect(() => {
    if (action) {
      document.title = `${action.isBuiltIn ? t(action.name) : action.name} - ${t('selection.name')}`
    }
  }, [action, t])

  useEffect(() => {
    shouldCloseWhenBlur.current = isAutoClose && !isPinned
  }, [isAutoClose, isPinned])

  useEffect(() => {
    //if the action is loaded, we should not set the opacity update from settings
    if (!isActionLoaded.current) {
      setOpacity(actionWindowOpacity)
    }
  }, [actionWindowOpacity])

  const handleMinimize = () => {
    window.api.selection.minimizeActionWindow()
  }

  const handleClose = () => {
    window.api.selection.closeActionWindow()
  }

  /**
   * @param pinned - if undefined, toggle the pinned state, otherwise force set the pinned state
   */
  const togglePin = () => {
    setIsPinned(!isPinned)
    window.api.selection.pinActionWindow(!isPinned)
  }

  const handleWindowFocus = () => {
    setIsWindowFocus(true)
  }

  const handleWindowBlur = () => {
    if (shouldCloseWhenBlur.current) {
      handleClose()
      return
    }

    setIsWindowFocus(false)
  }

  const handleOpacityChange = (value: number) => {
    setOpacity(value)
  }

  const handleScrollToBottom = () => {
    if (contentElementRef.current && isAutoScrollEnabled.current) {
      contentElementRef.current.scrollTo({
        top: contentElementRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }

  const handleUserScroll = () => {
    if (!contentElementRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = contentElementRef.current
    const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 24

    // Only update isAutoScrollEnabled if user is at bottom
    if (isAtBottom) {
      isAutoScrollEnabled.current = true
    } else {
      isAutoScrollEnabled.current = false
    }
  }

  //we don't need to render the component if action is not set
  if (!action) return null

  return (
    <WindowFrame $opacity={opacity / 100}>
      <TitleBar $isWindowFocus={isWindowFocus}>
        {action.icon && (
          <TitleBarIcon>
            <DynamicIcon
              name={action.icon as any}
              size={16}
              style={{ color: 'var(--color-text-1)' }}
              fallback={() => {}}
            />
          </TitleBarIcon>
        )}
        <TitleBarCaption>{action.isBuiltIn ? t(action.name) : action.name}</TitleBarCaption>
        <TitleBarButtons>
          <Tooltip
            title={isPinned ? t('selection.action.window.pinned') : t('selection.action.window.pin')}
            placement="bottom">
            <WinButton
              type="text"
              icon={<Pin size={14} className={isPinned ? 'pinned' : ''} />}
              onClick={togglePin}
              className={isPinned ? 'pinned' : ''}
            />
          </Tooltip>
          <Tooltip
            title={t('selection.action.window.opacity')}
            placement="bottom"
            {...(showOpacitySlider ? { open: false } : {})}>
            <WinButton
              type="text"
              icon={<Droplet size={14} />}
              onClick={() => setShowOpacitySlider(!showOpacitySlider)}
              className={showOpacitySlider ? 'active' : ''}
              style={{ paddingBottom: '2px' }}
            />
          </Tooltip>
          {showOpacitySlider && (
            <OpacitySlider>
              <Slider
                vertical
                min={20}
                max={100}
                value={opacity}
                onChange={handleOpacityChange}
                onChangeComplete={() => setShowOpacitySlider(false)}
                tooltip={{ formatter: (value) => `${value}%` }}
              />
            </OpacitySlider>
          )}

          <WinButton type="text" icon={<Minus size={16} />} onClick={handleMinimize} />
          <WinButton type="text" icon={<X size={16} />} onClick={handleClose} className="close" />
        </TitleBarButtons>
      </TitleBar>
      <Content ref={contentElementRef}>
        {action.id == 'translate' && <ActionTranslate action={action} scrollToBottom={handleScrollToBottom} />}
        {action.id != 'translate' && <ActionGeneral action={action} scrollToBottom={handleScrollToBottom} />}
      </Content>
    </WindowFrame>
  )
}

const WindowFrame = styled.div<{ $opacity: number }>`
  position: relative;
  display: flex;
  flex-direction: column;
  width: calc(100% - 6px);
  height: calc(100% - 6px);
  margin: 2px;
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  box-shadow: 0px 0px 2px var(--color-text-3);
  border-radius: 8px;
  overflow: hidden;
  box-sizing: border-box;
  opacity: ${(props) => props.$opacity};
`

const TitleBar = styled.div<{ $isWindowFocus: boolean }>`
  display: flex;
  align-items: center;
  flex-direction: row;
  height: 32px;
  padding: 0 8px;
  background-color: ${(props) =>
    props.$isWindowFocus ? 'var(--color-background-mute)' : 'var(--color-background-soft)'};
  transition: background-color 0.3s ease;
  -webkit-app-region: drag;
`

const TitleBarIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
`

const TitleBarCaption = styled.div`
  margin-left: 8px;
  font-size: 14px;
  font-weight: 400;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-1);
`

const TitleBarButtons = styled.div`
  display: flex;
  gap: 8px;
  -webkit-app-region: no-drag;
  position: relative;

  .lucide {
    &.pinned {
      color: var(--color-primary);
    }
  }
`

const WinButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 4px;
  transition: all 0.2s;
  color: var(--color-icon);

  .anticon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  svg {
    stroke-width: 2;
    transition: transform 0.2s ease;
  }

  &.pinned {
    svg {
      transform: rotate(45deg);
    }

    &:hover {
      background-color: var(--color-primary-mute) !important;
    }
  }

  &.close {
    &:hover {
      background-color: var(--color-error) !important;
      color: var(--color-white) !important;
    }
  }

  &.active {
    background-color: var(--color-primary-mute) !important;
    color: var(--color-primary) !important;
  }

  &:hover {
    background-color: var(--color-hover) !important;
    color: var(--color-icon-white) !important;
  }
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 16px;
  overflow: auto;
  font-size: 14px;
  -webkit-app-region: none;
  user-select: text;
  width: 100%;
`

const OpacitySlider = styled.div`
  position: absolute;
  left: 42px;
  top: 100%;
  margin-top: 8px;
  background-color: var(--color-background-mute);
  padding: 16px 8px 12px 8px;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
  height: 120px;
  /* display: flex; */
  align-items: center;
  justify-content: center;
  z-index: 10000;
  opacity: 1 !important;

  .ant-slider {
    height: 100%;
    margin: 0;
  }

  .ant-slider-rail {
    background-color: var(--color-border);
  }

  .ant-slider-track {
    background-color: var(--color-primary);
  }

  .ant-slider-handle {
    border-color: var(--color-primary);

    &:hover {
      border-color: var(--color-primary);
    }

    &.ant-slider-handle-active {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px var(--color-primary-mute);
    }
  }
`

export default SelectionActionApp
