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
      return (
        <ActionButton key={action.id} onClick={() => handleAction(action)}>
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
          {!isCompact && (
            <ActionTitle className="btn-title">{action.isBuiltIn ? t(action.name) : action.name}</ActionTitle>
          )}
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

  // listen to selectionService events
  useEffect(() => {
    // TextSelection
    const textSelectionListenRemover = window.electron?.ipcRenderer.on(
      IpcChannel.Selection_TextSelected,
      (_, selectionData: TextSelectionData) => {
        selectedText.current = selectionData.text
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

    if (!demo) updateWindowSize()

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

  const handleDefaultAction = (action: ActionItem) => {
    window.api?.selection.processAction(action)
    window.api?.selection.hideToolbar()
  }

  return (
    <Container>
      <LogoWrapper>
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
  align-items: center;
  border-radius: 6px;
  background-color: var(--color-selection-toolbar-background);
  border-color: var(--color-selection-toolbar-border);
  box-shadow: 0px 2px 3px var(--color-selection-toolbar-shadow);
  padding: 2px;
  margin: 2px 3px 5px 3px;
  user-select: none;
  border-width: 1px;
  border-style: solid;
  height: 36px;
  padding-right: 4px;
  box-sizing: border-box;
`

const LogoWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: drag;
  margin-left: 5px;
`

const Logo = styled(Avatar)`
  height: 22px;
  width: 22px;
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
  margin-left: 3px;
`
const ActionButton = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin: 0 2px;
  cursor: pointer;
  border-radius: 4px;
  padding: 4px 6px;
  .btn-icon {
    width: 16px;
    height: 16px;
    color: var(--color-selection-toolbar-text);
  }
  .btn-title {
    color: var(--color-selection-toolbar-text);
    --font-size: 14px;
  }
  &:hover {
    color: var(--color-primary);
    .btn-icon {
      color: var(--color-primary);
    }
    .btn-title {
      color: var(--color-primary);
    }
    background-color: var(--color-selection-toolbar-hover-bg);
  }
`
const ActionIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  /* margin-right: 3px; */
  position: relative;
  height: 16px;
  width: 16px;

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
    color: var(--color-error);
  }

  .icon-success {
    color: var(--color-primary);
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
  font-size: 14px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: 3px;
`

export default SelectionToolbar
