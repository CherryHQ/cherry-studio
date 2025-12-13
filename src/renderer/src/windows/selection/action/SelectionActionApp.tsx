import { isMac, isWin } from '@renderer/config/constant'
import { useSelectionAssistant } from '@renderer/hooks/useSelectionAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { defaultLanguage } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { Button, Slider, Tooltip } from 'antd'
import { Droplet, Minus, Pin, X } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import type { FC, MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

// [Windows only] Electron bug workaround type - can be removed once https://github.com/electron/electron/issues/48554 is fixed
type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

import ActionGeneral from './components/ActionGeneral'
import ActionTranslate from './components/ActionTranslate'

const SelectionActionApp: FC = () => {
  const { language, customCss } = useSettings()

  const { t } = useTranslation()

  const [action, setAction] = useState<ActionItem | null>(null)
  const isActionLoaded = useRef(false)

  const { isAutoClose, isAutoPin, actionWindowOpacity } = useSelectionAssistant()
  const [isPinned, setIsPinned] = useState(isAutoPin)
  const [isWindowFocus, setIsWindowFocus] = useState(true)

  const [showOpacitySlider, setShowOpacitySlider] = useState(false)
  const [opacity, setOpacity] = useState(actionWindowOpacity)

  const shouldCloseWhenBlur = useRef(false)
  const contentElementRef = useRef<HTMLDivElement>(null)
  const isAutoScrollEnabled = useRef(true)
  const lastScrollHeight = useRef(0)

  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isAutoPin) {
      window.api.selection.pinActionWindow(true)
      setIsPinned(true)
    } else if (!isActionLoaded.current) {
      window.api.selection.pinActionWindow(false)
      setIsPinned(false)
    }
  }, [isAutoPin])

  useEffect(() => {
    shouldCloseWhenBlur.current = isAutoClose && !isPinned
  }, [isAutoClose, isPinned])

  useEffect(() => {
    i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language])

  useEffect(() => {
    let customCssElement = document.getElementById('user-defined-custom-css') as HTMLStyleElement
    if (customCssElement) {
      customCssElement.remove()
    }

    if (customCss) {
      customCssElement = document.createElement('style')
      customCssElement.id = 'user-defined-custom-css'
      customCssElement.textContent = customCss
      document.head.appendChild(customCssElement)
    }
  }, [customCss])

  useEffect(() => {
    const contentEl = contentElementRef.current
    if (contentEl) {
      contentEl.addEventListener('scroll', handleUserScroll)
      // Initialize the scroll height
      lastScrollHeight.current = contentEl.scrollHeight
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

  //must useCallback to avoid re-rendering the component
  const handleScrollToBottom = useCallback(() => {
    if (contentElementRef.current && isAutoScrollEnabled.current) {
      contentElementRef.current.scrollTo({
        top: contentElementRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }, [])

  const handleUserScroll = () => {
    if (!contentElementRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = contentElementRef.current

    // Check if content height has increased (new content added)
    const contentIncreased = scrollHeight > lastScrollHeight.current
    lastScrollHeight.current = scrollHeight

    // If content increased and we're in auto-scroll mode, don't change the auto-scroll state
    if (contentIncreased && isAutoScrollEnabled.current) {
      return
    }

    // Only check user position if content didn't increase
    const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 32

    if (isAtBottom) {
      isAutoScrollEnabled.current = true
    } else {
      isAutoScrollEnabled.current = false
    }
  }

  /**
   * [Windows only] Manual window resize handler
   *
   * ELECTRON BUG WORKAROUND:
   * In Electron, when using `frame: false` + `transparent: true`, the native window
   * resize functionality is broken on Windows. This is a known Electron bug.
   * See: https://github.com/electron/electron/issues/48554
   *
   * This custom resize implementation can be removed once the Electron bug is fixed.
   */
  const handleResizeStart = useCallback((e: ReactMouseEvent, direction: ResizeDirection) => {
    e.preventDefault()
    e.stopPropagation()

    let lastX = e.screenX
    let lastY = e.screenY

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.screenX - lastX
      const deltaY = moveEvent.screenY - lastY

      if (deltaX !== 0 || deltaY !== 0) {
        window.api.selection.resizeActionWindow(deltaX, deltaY, direction)
        lastX = moveEvent.screenX
        lastY = moveEvent.screenY
      }
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [])

  //we don't need to render the component if action is not set
  if (!action) return null

  return (
    <WindowFrame $opacity={opacity / 100}>
      {/* [Windows only] Custom resize handles - Electron bug workaround, can be removed once fixed */}
      {isWin && (
        <>
          <ResizeHandle $direction="n" onMouseDown={(e) => handleResizeStart(e, 'n')} />
          <ResizeHandle $direction="s" onMouseDown={(e) => handleResizeStart(e, 's')} />
          <ResizeHandle $direction="e" onMouseDown={(e) => handleResizeStart(e, 'e')} />
          <ResizeHandle $direction="w" onMouseDown={(e) => handleResizeStart(e, 'w')} />
          <ResizeHandle $direction="ne" onMouseDown={(e) => handleResizeStart(e, 'ne')} />
          <ResizeHandle $direction="nw" onMouseDown={(e) => handleResizeStart(e, 'nw')} />
          <ResizeHandle $direction="se" onMouseDown={(e) => handleResizeStart(e, 'se')} />
          <ResizeHandle $direction="sw" onMouseDown={(e) => handleResizeStart(e, 'sw')} />
        </>
      )}

      <TitleBar $isWindowFocus={isWindowFocus} style={isMac ? { paddingLeft: '70px' } : {}}>
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
          {!isMac && (
            <>
              <WinButton type="text" icon={<Minus size={16} />} onClick={handleMinimize} />
              <WinButton type="text" icon={<X size={16} />} onClick={handleClose} className="close" />
            </>
          )}
        </TitleBarButtons>
      </TitleBar>
      <MainContainer>
        <Content ref={contentElementRef}>
          {action.id == 'translate' && <ActionTranslate action={action} scrollToBottom={handleScrollToBottom} />}
          {action.id != 'translate' && <ActionGeneral action={action} scrollToBottom={handleScrollToBottom} />}
        </Content>
      </MainContainer>
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

const MainContainer = styled.div`
  display: flex;
  justify-content: center;
  width: 100%;
  height: 100%;
  overflow: auto;
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
  /* width: 100%; */
  max-width: 1280px;
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

/**
 * [Windows only] Custom resize handle styled component
 *
 * ELECTRON BUG WORKAROUND:
 * This component can be removed once https://github.com/electron/electron/issues/48554 is fixed.
 */
const ResizeHandle = styled.div<{ $direction: ResizeDirection }>`
  position: absolute;
  -webkit-app-region: no-drag;
  z-index: 10;

  ${({ $direction }) => {
    const edgeSize = '6px'
    const cornerSize = '12px'

    switch ($direction) {
      case 'n':
        return `
          top: 0;
          left: ${cornerSize};
          right: ${cornerSize};
          height: ${edgeSize};
          cursor: ns-resize;
        `
      case 's':
        return `
          bottom: 0;
          left: ${cornerSize};
          right: ${cornerSize};
          height: ${edgeSize};
          cursor: ns-resize;
        `
      case 'e':
        return `
          right: 0;
          top: ${cornerSize};
          bottom: ${cornerSize};
          width: ${edgeSize};
          cursor: ew-resize;
        `
      case 'w':
        return `
          left: 0;
          top: ${cornerSize};
          bottom: ${cornerSize};
          width: ${edgeSize};
          cursor: ew-resize;
        `
      case 'ne':
        return `
          top: 0;
          right: 0;
          width: ${cornerSize};
          height: ${cornerSize};
          cursor: nesw-resize;
        `
      case 'nw':
        return `
          top: 0;
          left: 0;
          width: ${cornerSize};
          height: ${cornerSize};
          cursor: nwse-resize;
        `
      case 'se':
        return `
          bottom: 0;
          right: 0;
          width: ${cornerSize};
          height: ${cornerSize};
          cursor: nwse-resize;
        `
      case 'sw':
        return `
          bottom: 0;
          left: 0;
          width: ${cornerSize};
          height: ${cornerSize};
          cursor: nesw-resize;
        `
      default:
        return ''
    }
  }}
`

export default SelectionActionApp
