import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import SelectionToolbarView from '@renderer/components/selection/SelectionToolbarView'
import { useTimer } from '@renderer/hooks/useTimer'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('SelectionToolbar')

const getCssPixelValue = (value: string) => Number.parseFloat(value) || 0

const getElementOuterSize = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)

  return {
    width: rect.width + getCssPixelValue(style.marginLeft) + getCssPixelValue(style.marginRight),
    height: rect.height + getCssPixelValue(style.marginTop) + getCssPixelValue(style.marginBottom)
  }
}

//tell main the actual size of the content
const updateWindowSize = (contentElement?: HTMLElement | null) => {
  const rootElement = document.getElementById('root')
  const targetElement =
    contentElement ??
    (rootElement?.firstElementChild instanceof HTMLElement ? rootElement.firstElementChild : rootElement)

  if (!targetElement) {
    logger.error('Toolbar content element not found')
    return
  }

  const { width, height } = getElementOuterSize(targetElement)

  // ceil to whole pixels so the OS window never clips sub-pixel content
  void ipcApi.request('selection.determine_toolbar_size', {
    width: Math.ceil(width),
    height: Math.ceil(height)
  })
}

const SelectionToolbar: FC = () => {
  const [isCompact] = usePreference('feature.selection.compact')
  const [actionItems] = usePreference('feature.selection.action_items')
  const [copyIconStatus, setCopyIconStatus] = useState<'normal' | 'success' | 'fail'>('normal')
  const [copyIconAnimation, setCopyIconAnimation] = useState<'none' | 'enter' | 'exit'>('none')
  const { setTimeoutTimer, clearTimeoutTimer } = useTimer()
  const toolbarRef = useRef<HTMLDivElement>(null)

  const realActionItems = useMemo(() => {
    return actionItems?.filter((item) => item.enabled)
  }, [actionItems])

  const selectedText = useRef('')
  // [macOS] only macOS has the fullscreen mode
  const isFullScreen = useRef(false)

  const onHideCleanUp = useCallback(() => {
    setCopyIconStatus('normal')
    setCopyIconAnimation('none')
    clearTimeoutTimer('copyIcon')
  }, [clearTimeoutTimer])

  // listen to selection events pushed from main (useIpcOn self-cleans on unmount)
  useIpcOn('selection.text_selected', (selectionData) => {
    selectedText.current = selectionData.text
    isFullScreen.current = selectionData.isFullscreen ?? false
  })

  useIpcOn('selection.toolbar_visibility_change', (isVisible) => {
    if (!isVisible) {
      updateWindowSize(toolbarRef.current)
      onHideCleanUp()
    }
  })

  //make sure the toolbar size is updated when the compact mode/actionItems is changed
  useEffect(() => {
    updateWindowSize(toolbarRef.current)
  }, [isCompact, actionItems])

  /**
   * Check if text is a valid URI or file path
   */
  const isUriOrFilePath = (text: string): boolean => {
    const trimmed = text.trim()
    // Must not contain newlines or whitespace
    if (/\s/.test(trimmed)) {
      return false
    }
    // URI patterns: http://, https://, ftp://, file://, etc.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
      return true
    }
    // Windows absolute path: C:\, D:\, etc.
    if (/^[a-zA-Z]:[/\\]/.test(trimmed)) {
      return true
    }
    // Unix absolute path: /path/to/file
    if (/^\/[^/]/.test(trimmed)) {
      return true
    }
    return false
  }

  // copy selected text to clipboard
  const handleCopy = useCallback(async () => {
    if (selectedText.current) {
      const result = await ipcApi.request('selection.write_to_clipboard', selectedText.current)

      setCopyIconStatus(result ? 'success' : 'fail')
      setCopyIconAnimation('enter')
      setTimeoutTimer(
        'copyIcon',
        () => {
          setCopyIconAnimation('exit')
        },
        2000
      )
    }
  }, [setTimeoutTimer])

  const handleSearch = useCallback((action: SelectionActionItem) => {
    if (!action.selectedText) return

    const selectedText = action.selectedText.trim()

    let actionString = ''
    if (isUriOrFilePath(selectedText)) {
      actionString = selectedText
    } else {
      if (!action.searchEngine) return

      const customUrl = action.searchEngine.split('|')[1]
      if (!customUrl) return

      actionString = customUrl.replace('{{queryString}}', encodeURIComponent(selectedText))
    }

    void ipcApi.request('system.shell.open_website', actionString)
    void ipcApi.request('selection.hide_toolbar')
  }, [])

  /**
   * Quote the selected text to the inputbar of the main window
   */
  const handleQuote = (action: SelectionActionItem) => {
    if (action.selectedText) {
      void window.api?.quoteToMainWindow(action.selectedText)
      void ipcApi.request('selection.hide_toolbar')
    }
  }

  const handleDefaultAction = (action: SelectionActionItem) => {
    // [macOS] only macOS has the available isFullscreen mode
    void ipcApi.request('selection.process_action', { actionItem: action, isFullScreen: isFullScreen.current })
    void ipcApi.request('selection.hide_toolbar')
  }

  const handleAction = useCallback(
    (action: SelectionActionItem) => {
      /** avoid mutating the original action, it will cause syncing issue */
      const newAction = { ...action, selectedText: selectedText.current }

      switch (action.id) {
        case 'copy':
          void handleCopy()
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
    [handleCopy, handleSearch]
  )

  return (
    <SelectionToolbarView
      ref={toolbarRef}
      actionItems={realActionItems}
      isCompact={isCompact}
      handleAction={handleAction}
      copyIconStatus={copyIconStatus}
      copyIconAnimation={copyIconAnimation}
      draggable
    />
  )
}

export default SelectionToolbar
