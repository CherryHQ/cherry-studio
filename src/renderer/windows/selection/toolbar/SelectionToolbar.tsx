import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import SelectionToolbarView from '@renderer/components/selection/SelectionToolbarView'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useTimer } from '@renderer/hooks/useTimer'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import {
  getSelectionActionAgent,
  parseSelectionActions,
  SELECTION_AGENT_ISSUE_LABEL_KEYS
} from '@renderer/utils/selectionAction'
import { AGENTS_MAX_LIMIT } from '@shared/data/api/schemas/agents'
import { SELECTION_BUILTIN_ACTION_ID, type SearchSelectionAction, type SelectionAction } from '@shared/types/selection'

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
    return parseSelectionActions(actionItems ?? []).filter((item) => item.enabled)
  }, [actionItems])

  // Not useAgents(): it pulls agent mutations and toasts into this minimal window.
  const { data: agentPage, refetch: refetchAgents } = useQuery('/agents', { query: { limit: AGENTS_MAX_LIMIT } })
  useDataChange('/agents', () => void refetchAgents())
  const { t } = useTranslation()
  const unavailableReasons = useMemo(() => {
    // Until agents load, leave every action usable rather than flash it disabled.
    if (!agentPage) return undefined
    const reasons: Record<string, string> = {}
    for (const action of realActionItems) {
      const issue = getSelectionActionAgent(action, agentPage.items)?.issue
      if (issue) reasons[action.id] = t(SELECTION_AGENT_ISSUE_LABEL_KEYS[issue])
    }
    return reasons
  }, [agentPage, realActionItems, t])

  const selectedText = useRef('')
  const programName = useRef('')
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
    programName.current = selectionData.programName
    isFullScreen.current = selectionData.isFullscreen ?? false
  })

  useIpcOn('selection.toolbar_visibility_change', (isVisible) => {
    if (!isVisible) {
      updateWindowSize(toolbarRef.current)
      onHideCleanUp()
    }
  })

  //make sure the toolbar size is updated when the compact mode/actionItems/availability is changed
  useEffect(() => {
    updateWindowSize(toolbarRef.current)
  }, [isCompact, actionItems, unavailableReasons])

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

  const handleSearch = useCallback((action: SearchSelectionAction) => {
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
  const handleQuote = (action: SelectionAction) => {
    if (action.selectedText) {
      void window.api?.quoteToMainWindow(action.selectedText)
      void ipcApi.request('selection.hide_toolbar')
    }
  }

  const handleDefaultAction = (action: SelectionAction) => {
    // [macOS] only macOS has the available isFullscreen mode
    void ipcApi.request('selection.process_action', { actionItem: action, isFullScreen: isFullScreen.current })
    void ipcApi.request('selection.hide_toolbar')
  }

  const handleAction = useCallback(
    (action: SelectionAction) => {
      /** avoid mutating the original action, it will cause syncing issue */
      const newAction = { ...action, selectedText: selectedText.current, programName: programName.current }

      if (newAction.isBuiltIn) {
        switch (newAction.id) {
          case SELECTION_BUILTIN_ACTION_ID.COPY:
            void handleCopy()
            return
          case SELECTION_BUILTIN_ACTION_ID.SEARCH:
            handleSearch(newAction)
            return
          case SELECTION_BUILTIN_ACTION_ID.QUOTE:
            handleQuote(newAction)
            return
        }
      }
      handleDefaultAction(newAction)
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
      unavailableReasons={unavailableReasons}
      draggable
    />
  )
}

export default SelectionToolbar
