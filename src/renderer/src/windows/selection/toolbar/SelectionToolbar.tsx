import '@renderer/assets/styles/selection-toolbar.scss'

import { AppLogo } from '@renderer/config/env'
import { useSelectionAssistant } from '@renderer/hooks/useSelectionAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import i18n from '@renderer/i18n'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { defaultLanguage } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { Avatar } from 'antd'
import { ClipboardCheck, ClipboardCopy, ClipboardX, MessageSquareHeart } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import { FC, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TextSelectionData } from 'selection-hook'
import styled from 'styled-components'

//tell main the actual size of the content
const updateWindowSize = () => {
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    console.error('SelectionToolbar: Root element not found')
    return
  }
  window.api?.selection.determineToolbarSize(rootElement.scrollWidth, rootElement.scrollHeight)
}

/**
 * ActionIcons is a component that renders the action icons
 */
const ActionIcons: FC<{
  actionItems: ActionItem[]
  isCompact: boolean
  handleAction: (action: ActionItem) => void
  copyIconStatus: 'normal' | 'success' | 'fail'
  copyIconAnimation: 'none' | 'enter' | 'exit'
}> = memo(({ actionItems, isCompact, handleAction, copyIconStatus, copyIconAnimation }) => {
  const { t } = useTranslation()

  const renderCopyIcon = useCallback(() => {
    return (
      <>
        <ClipboardCopy
          className={`btn-icon ${
            copyIconAnimation === 'enter' ? 'icon-scale-out' : copyIconAnimation === 'exit' ? 'icon-fade-in' : ''
          }`}
        />
        {copyIconStatus === 'success' && (
          <ClipboardCheck
            className={`btn-icon icon-success ${
              copyIconAnimation === 'enter' ? 'icon-scale-in' : copyIconAnimation === 'exit' ? 'icon-fade-out' : ''
            }`}
          />
        )}
        {copyIconStatus === 'fail' && (
          <ClipboardX
            className={`btn-icon icon-fail ${
              copyIconAnimation === 'enter' ? 'icon-scale-in' : copyIconAnimation === 'exit' ? 'icon-fade-out' : ''
            }`}
          />
        )}
      </>
    )
  }, [copyIconStatus, copyIconAnimation])

  const renderActionButton = useCallback(
    (action: ActionItem) => {
      const displayName = action.isBuiltIn ? t(action.name) : action.name

      return (
        <ActionButton key={action.id} onClick={() => handleAction(action)} title={isCompact ? displayName : undefined}>
          <ActionIcon>
            {action.id === 'copy' ? (
              renderCopyIcon()
            ) : (
              <DynamicIcon
                key={action.id}
                name={action.icon as any}
                className="btn-icon"
                fallback={() => <MessageSquareHeart className="btn-icon" />}
              />
            )}
          </ActionIcon>
          {!isCompact && <ActionTitle className="btn-title">{displayName}</ActionTitle>}
        </ActionButton>
      )
    },
    [handleAction, isCompact, t, renderCopyIcon]
  )

  return <>{actionItems?.map(renderActionButton)}</>
})

/**
 * demo is used in the settings page
 */
const SelectionToolbar: FC<{ demo?: boolean }> = ({ demo = false }) => {
  const { language, customCss } = useSettings()
  const { isCompact, actionItems } = useSelectionAssistant()
  const [animateKey, setAnimateKey] = useState(0)
  const [copyIconStatus, setCopyIconStatus] = useState<'normal' | 'success' | 'fail'>('normal')
  const [copyIconAnimation, setCopyIconAnimation] = useState<'none' | 'enter' | 'exit'>('none')
  const copyIconTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  const realActionItems = useMemo(() => {
    return actionItems?.filter((item) => item.enabled)
  }, [actionItems])

  const selectedText = useRef('')
  // [macOS] only macOS has the fullscreen mode
  const isFullScreen = useRef(false)

  // listen to selectionService events
  useEffect(() => {
    // TextSelection
    const textSelectionListenRemover = window.electron?.ipcRenderer.on(
      IpcChannel.Selection_TextSelected,
      (_, selectionData: TextSelectionData) => {
        selectedText.current = selectionData.text
        isFullScreen.current = selectionData.isFullscreen ?? false
        setTimeout(() => {
          //make sure the animation is active
          setAnimateKey((prev) => prev + 1)
        }, 400)
      }
    )

    // ToolbarVisibilityChange
    const toolbarVisibilityChangeListenRemover = window.electron?.ipcRenderer.on(
      IpcChannel.Selection_ToolbarVisibilityChange,
      (_, isVisible: boolean) => {
        if (!isVisible) {
          if (!demo) updateWindowSize()
          onHideCleanUp()
        }
      }
    )

    return () => {
      textSelectionListenRemover()
      toolbarVisibilityChangeListenRemover()
    }
  }, [demo])

  //make sure the toolbar size is updated when the compact mode/actionItems is changed
  useEffect(() => {
    if (!demo) updateWindowSize()
  }, [demo, isCompact, actionItems])

  useEffect(() => {
    !demo && i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language, demo])

  useEffect(() => {
    if (demo) return

    let customCssElement = document.getElementById('user-defined-custom-css') as HTMLStyleElement
    if (customCssElement) {
      customCssElement.remove()
    }

    if (customCss) {
      const newCustomCss = customCss.replace(/(^|\s)background(-image|-color)?\s*:[^;]+;/gi, '')

      customCssElement = document.createElement('style')
      customCssElement.id = 'user-defined-custom-css'
      customCssElement.textContent = newCustomCss
      document.head.appendChild(customCssElement)
    }
  }, [customCss, demo])

  const onHideCleanUp = () => {
    setCopyIconStatus('normal')
    setCopyIconAnimation('none')
    clearTimeout(copyIconTimeoutRef.current)
  }

  const handleAction = useCallback(
    (action: ActionItem) => {
      if (demo) return

      /** avoid mutating the original action, it will cause syncing issue */
      const newAction = { ...action, selectedText: selectedText.current }

      switch (action.id) {
        case 'copy':
          handleCopy()
          break
        case 'search':
          handleSearch(newAction)
          break
        case 'quote':
          handleQuote(newAction)
          break
        default:
          handleDefaultAction(newAction)
          break
      }
    },
    [demo]
  )

  // copy selected text to clipboard
  const handleCopy = async () => {
    if (selectedText.current) {
      const result = await window.api?.selection.writeToClipboard(selectedText.current)

      setCopyIconStatus(result ? 'success' : 'fail')
      setCopyIconAnimation('enter')
      copyIconTimeoutRef.current = setTimeout(() => {
        setCopyIconAnimation('exit')
      }, 2000)
    }
  }

  const handleSearch = (action: ActionItem) => {
    if (!action.searchEngine) return

    const customUrl = action.searchEngine.split('|')[1]
    if (!customUrl) return

    const searchUrl = customUrl.replace('{{queryString}}', encodeURIComponent(action.selectedText || ''))
    window.api?.openWebsite(searchUrl)
    window.api?.selection.hideToolbar()
  }

  /**
   * Quote the selected text to the inputbar of the main window
   */
  const handleQuote = (action: ActionItem) => {
    if (action.selectedText) {
      window.api?.quoteToMainWindow(action.selectedText)
      window.api?.selection.hideToolbar()
    }
  }

  const handleDefaultAction = (action: ActionItem) => {
    // [macOS] only macOS has the available isFullscreen mode
    window.api?.selection.processAction(action, isFullScreen.current)
    window.api?.selection.hideToolbar()
  }

  return (
    <Container>
      <LogoWrapper $draggable={!demo}>
        <Logo src={AppLogo} key={animateKey} className="animate" draggable={false} />
      </LogoWrapper>
      <ActionWrapper>
        <ActionIcons
          actionItems={realActionItems}
          isCompact={isCompact}
          handleAction={handleAction}
          copyIconStatus={copyIconStatus}
          copyIconAnimation={copyIconAnimation}
        />
      </ActionWrapper>
    </Container>
  )
}

const Container = styled.div`
  display: inline-flex;
  flex-direction: row;
  align-items: stretch;
  height: var(--selection-toolbar-height);
  border-radius: var(--selection-toolbar-border-radius);
  border: var(--selection-toolbar-border);
  box-shadow: var(--selection-toolbar-box-shadow);
  background: var(--selection-toolbar-background);
  padding: var(--selection-toolbar-padding) !important;
  margin: var(--selection-toolbar-margin) !important;
  user-select: none;
  box-sizing: border-box;
  overflow: hidden;
`

const LogoWrapper = styled.div<{ $draggable: boolean }>`
  display: var(--selection-toolbar-logo-display);
  align-items: center;
  justify-content: center;
  margin: var(--selection-toolbar-logo-margin);
  padding: var(--selection-toolbar-logo-padding);
  background-color: var(--selection-toolbar-logo-background);
  border-width: var(--selection-toolbar-logo-border-width);
  border-style: var(--selection-toolbar-logo-border-style);
  border-color: var(--selection-toolbar-logo-border-color);
  border-radius: var(--selection-toolbar-border-radius) 0 0 var(--selection-toolbar-border-radius);
  ${({ $draggable }) => $draggable && ' -webkit-app-region: drag;'};
`

const Logo = styled(Avatar)`
  height: var(--selection-toolbar-logo-size);
  width: var(--selection-toolbar-logo-size);
  &.animate {
    animation: rotate 1s ease;
  }
  @keyframes rotate {
    0% {
      transform: rotate(0deg) scale(1);
    }
    25% {
      transform: rotate(-15deg) scale(1.05);
    }
    75% {
      transform: rotate(15deg) scale(1.05);
    }
    100% {
      transform: rotate(0deg) scale(1);
    }
  }
`

const ActionWrapper = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  border-width: var(--selection-toolbar-buttons-border-width);
  border-style: var(--selection-toolbar-buttons-border-style);
  border-color: var(--selection-toolbar-buttons-border-color);
  border-radius: var(--selection-toolbar-buttons-border-radius);
`
const ActionButton = styled.div`
  height: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer !important;
  margin: var(--selection-toolbar-button-margin);
  padding: var(--selection-toolbar-button-padding);
  background-color: var(--selection-toolbar-button-bgcolor);
  border-radius: var(--selection-toolbar-button-border-radius);
  border: var(--selection-toolbar-button-border);
  box-shadow: var(--selection-toolbar-button-box-shadow);
  transition: all 0.1s ease-in-out;
  will-change: color, background-color;
  &:last-child {
    border-radius: 0 var(--selection-toolbar-border-radius) var(--selection-toolbar-border-radius) 0;
    padding: var(--selection-toolbar-button-last-padding);
  }

  .btn-icon {
    width: var(--selection-toolbar-button-icon-size);
    height: var(--selection-toolbar-button-icon-size);
    color: var(--selection-toolbar-button-icon-color);
    background-color: transparent;
    transition: color 0.1s ease-in-out;
    will-change: color;
  }
  .btn-title {
    color: var(--selection-toolbar-button-text-color);
    transition: color 0.1s ease-in-out;
    will-change: color;
    line-height: 1.1;
  }
  &:hover {
    .btn-icon {
      color: var(--selection-toolbar-button-icon-color-hover);
    }
    .btn-title {
      color: var(--selection-toolbar-button-text-color-hover);
    }
    background-color: var(--selection-toolbar-button-bgcolor-hover);
  }
`
const ActionIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  height: var(--selection-toolbar-button-icon-size);
  width: var(--selection-toolbar-button-icon-size);
  background-color: transparent;

  .btn-icon {
    position: absolute;
    top: 0;
    left: 0;
  }

  .btn-icon:nth-child(2) {
    top: 0px;
    left: 0px;
  }

  .icon-fail {
    color: var(--selection-toolbar-color-error);
  }

  .icon-success {
    color: var(--selection-toolbar-color-primary);
  }

  .icon-scale-in {
    animation: scaleIn 0.5s forwards;
  }

  .icon-scale-out {
    animation: scaleOut 0.5s forwards;
  }

  .icon-fade-in {
    animation: fadeIn 0.3s forwards;
  }

  .icon-fade-out {
    animation: fadeOut 0.3s forwards;
  }

  @keyframes scaleIn {
    from {
      transform: scale(0);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  @keyframes scaleOut {
    from {
      transform: scale(1);
      opacity: 1;
    }
    to {
      transform: scale(0);
      opacity: 0;
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes fadeOut {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
`
const ActionTitle = styled.span`
  font-size: var(--selection-toolbar-font-size);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: var(--selection-toolbar-button-text-margin);
  background-color: transparent;
`

export default SelectionToolbar
