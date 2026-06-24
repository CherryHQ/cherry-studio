import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { AppLogo } from '@renderer/config/env'
import { useTimer } from '@renderer/hooks/useTimer'
import i18n from '@renderer/i18n'
import { ipcApi } from '@renderer/ipc'
import { useIpcOn } from '@renderer/ipc/useIpcOn'
import { cn } from '@renderer/utils/style'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { defaultLanguage } from '@shared/utils/languages'
import { ClipboardCheck, ClipboardCopy, ClipboardX, MessageSquareHeart } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

/**
 * ActionIcons is a component that renders the action icons
 */
const ActionIcons: FC<{
  actionItems: SelectionActionItem[]
  isCompact: boolean
  handleAction: (action: SelectionActionItem) => void
  copyIconStatus: 'normal' | 'success' | 'fail'
  copyIconAnimation: 'none' | 'enter' | 'exit'
}> = memo(({ actionItems, isCompact, handleAction, copyIconStatus, copyIconAnimation }) => {
  const { t } = useTranslation()

  const copyBaseClassName = cn(
    'absolute inset-0 transition-[color,opacity,transform] duration-300',
    '[height:var(--selection-toolbar-button-icon-size,16px)]',
    '[width:var(--selection-toolbar-button-icon-size,16px)]'
  )

  const renderCopyIcon = useCallback(() => {
    const shouldShowStatus = copyIconStatus !== 'normal'

    return (
      <>
        <ClipboardCopy
          className={cn(
            'btn-icon',
            copyBaseClassName,
            copyIconAnimation === 'enter' && shouldShowStatus && 'scale-0 opacity-0',
            copyIconAnimation !== 'enter' && 'scale-100 opacity-100'
          )}
        />
        {copyIconStatus === 'success' && (
          <ClipboardCheck
            className={cn(
              'btn-icon text-primary',
              copyBaseClassName,
              copyIconAnimation === 'enter' && 'scale-100 opacity-100',
              copyIconAnimation !== 'enter' && 'scale-0 opacity-0'
            )}
          />
        )}
        {copyIconStatus === 'fail' && (
          <ClipboardX
            className={cn(
              'btn-icon text-error-base',
              copyBaseClassName,
              copyIconAnimation === 'enter' && 'scale-100 opacity-100',
              copyIconAnimation !== 'enter' && 'scale-0 opacity-0'
            )}
          />
        )}
      </>
    )
  }, [copyBaseClassName, copyIconAnimation, copyIconStatus])

  const renderActionButton = useCallback(
    (action: SelectionActionItem) => {
      const displayName = action.isBuiltIn ? t(action.name) : action.name

      return (
        <button
          type="button"
          key={action.id}
          onClick={() => handleAction(action)}
          title={isCompact ? displayName : undefined}
          aria-label={displayName}
          className={cn(
            'group flex h-full cursor-pointer! flex-row items-center justify-center gap-0.5 border-none bg-transparent transition-colors duration-100 [-webkit-app-region:no-drag]',
            '[background-color:var(--selection-toolbar-button-bgcolor,transparent)]',
            '[border-radius:var(--selection-toolbar-button-border-radius,0)]',
            '[border:var(--selection-toolbar-button-border,0)]',
            '[box-shadow:var(--selection-toolbar-button-box-shadow,none)]',
            '[margin:var(--selection-toolbar-button-margin,0)]',
            '[padding:var(--selection-toolbar-button-padding,0_8px)]',
            'last:rounded-r-[var(--selection-toolbar-border-radius,10px)]',
            'last:[padding:var(--selection-toolbar-button-last-padding,0_12px_0_8px)]',
            'hover:[background-color:var(--selection-toolbar-button-bgcolor-hover,rgb(0_0_0_/_0.04))]',
            'dark:hover:[background-color:var(--selection-toolbar-button-bgcolor-hover,#333333)]'
          )}>
          <span
            className={cn(
              'relative flex items-center justify-center bg-transparent',
              '[height:var(--selection-toolbar-button-icon-size,16px)]',
              '[width:var(--selection-toolbar-button-icon-size,16px)]',
              '[&_svg]:[color:var(--selection-toolbar-button-icon-color,rgb(0_0_0))]',
              'dark:[&_svg]:[color:var(--selection-toolbar-button-icon-color,rgb(255_255_245_/_0.9))]',
              'group-hover:[&_svg]:text-primary'
            )}>
            {action.id === 'copy' ? (
              renderCopyIcon()
            ) : (
              <DynamicIcon
                key={action.id}
                name={action.icon as any}
                className="btn-icon absolute inset-0 size-full bg-transparent transition-colors duration-100"
                fallback={() => (
                  <MessageSquareHeart className="btn-icon absolute inset-0 size-full bg-transparent transition-colors duration-100" />
                )}
              />
            )}
          </span>
          {!isCompact && (
            <span
              className={cn(
                'btn-title max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap bg-transparent leading-[1.1] transition-colors duration-100',
                '[color:var(--selection-toolbar-button-text-color,rgb(0_0_0))]',
                'dark:[color:var(--selection-toolbar-button-text-color,rgb(255_255_245_/_0.9))]',
                '[font-size:var(--selection-toolbar-font-size,14px)]',
                '[margin:var(--selection-toolbar-button-text-margin,0)]',
                'group-hover:text-primary'
              )}>
              {displayName}
            </span>
          )}
        </button>
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
  const [language] = usePreference('app.language')
  const [customCss] = usePreference('ui.custom_css')
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
      if (!demo) updateWindowSize(toolbarRef.current)
      onHideCleanUp()
    }
  })

  //make sure the toolbar size is updated when the compact mode/actionItems is changed
  useEffect(() => {
    if (!demo) updateWindowSize(toolbarRef.current)
  }, [demo, isCompact, actionItems])

  useEffect(() => {
    void (!demo && i18n.changeLanguage(language || navigator.language || defaultLanguage))
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

    void window.api?.openWebsite(actionString)
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
      if (demo) return

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
    [demo, handleCopy, handleSearch]
  )

  return (
    <div
      ref={toolbarRef}
      className={cn(
        'box-border inline-flex select-none flex-row items-stretch overflow-hidden font-[var(--font-family-body)]',
        '[background:var(--selection-toolbar-background,rgb(245_245_245_/_0.95))]',
        'dark:[background:var(--selection-toolbar-background,rgb(20_20_20_/_0.95))]',
        '[border-radius:var(--selection-toolbar-border-radius,10px)]',
        '[border:var(--selection-toolbar-border,0)]',
        '[box-shadow:var(--selection-toolbar-box-shadow,0_2px_3px_rgb(50_50_50_/_0.1))]',
        'dark:[box-shadow:var(--selection-toolbar-box-shadow,0_2px_3px_rgb(50_50_50_/_0.3))]',
        '[height:var(--selection-toolbar-height,36px)]',
        '[margin:var(--selection-toolbar-margin,2px_3px_5px_3px)!]',
        '[padding:var(--selection-toolbar-padding,0)!]'
      )}>
      <div
        className={cn(
          'items-center justify-center',
          '[background-color:var(--selection-toolbar-logo-background,transparent)]',
          '[border-color:var(--selection-toolbar-logo-border-color,rgb(0_0_0_/_0.08))]',
          'dark:[border-color:var(--selection-toolbar-logo-border-color,rgb(255_255_255_/_0.2))]',
          '[border-style:var(--selection-toolbar-logo-border-style,solid)]',
          '[border-width:var(--selection-toolbar-logo-border-width,0.5px_0_0.5px_0.5px)]',
          '[display:var(--selection-toolbar-logo-display,flex)]',
          '[margin:var(--selection-toolbar-logo-margin,0)]',
          '[padding:var(--selection-toolbar-logo-padding,0_6px_0_8px)]',
          'rounded-l-[var(--selection-toolbar-border-radius,10px)]',
          !demo && '[-webkit-app-region:drag]'
        )}>
        <img
          src={AppLogo}
          className="rounded-full object-cover [height:var(--selection-toolbar-logo-size,22px)] [width:var(--selection-toolbar-logo-size,22px)]"
          draggable={false}
          alt=""
        />
      </div>
      <div
        className={cn(
          'flex flex-row items-center justify-center bg-transparent [-webkit-app-region:no-drag]',
          '[border-color:var(--selection-toolbar-buttons-border-color,rgb(0_0_0_/_0.08))]',
          'dark:[border-color:var(--selection-toolbar-buttons-border-color,rgb(255_255_255_/_0.2))]',
          '[border-radius:var(--selection-toolbar-buttons-border-radius,0_var(--selection-toolbar-border-radius,10px)_var(--selection-toolbar-border-radius,10px)_0)]',
          '[border-style:var(--selection-toolbar-buttons-border-style,solid)]',
          '[border-width:var(--selection-toolbar-buttons-border-width,0.5px_0.5px_0.5px_0)]'
        )}>
        <ActionIcons
          actionItems={realActionItems}
          isCompact={isCompact}
          handleAction={handleAction}
          copyIconStatus={copyIconStatus}
          copyIconAnimation={copyIconAnimation}
        />
      </div>
    </div>
  )
}

export default SelectionToolbar
