import { Button, Input } from '@heroui/react'
import { loggerService } from '@logger'
import type { WebviewTag } from 'electron'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type FoundInPageResult = Electron.FoundInPageResult

interface WebviewSearchProps {
  webviewRef: React.RefObject<WebviewTag | null>
  isWebviewReady: boolean
  appId: string
}

const logger = loggerService.withContext('WebviewSearch')

const WebviewSearch: FC<WebviewSearchProps> = ({ webviewRef, isWebviewReady, appId }) => {
  const { t } = useTranslation()
  const [isVisible, setIsVisible] = useState(false)
  const [query, setQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [currentWebview, setCurrentWebview] = useState<WebviewTag | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const focusFrameRef = useRef<number | null>(null)
  const lastAppIdRef = useRef<string>(appId)
  const attachedWebviewRef = useRef<WebviewTag | null>(null)

  const focusInput = useCallback(() => {
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current)
      focusFrameRef.current = null
    }
    focusFrameRef.current = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const resetSearchState = useCallback((options?: { keepQuery?: boolean }) => {
    if (!options?.keepQuery) {
      setQuery('')
    }
    setMatchCount(0)
    setActiveIndex(0)
  }, [])

  const stopSearch = useCallback(() => {
    const target = webviewRef.current ?? attachedWebviewRef.current
    if (!target) return
    try {
      target.stopFindInPage('clearSelection')
    } catch (error) {
      logger.error('stopFindInPage failed', { error })
    }
  }, [webviewRef])

  const closeSearch = useCallback(() => {
    setIsVisible(false)
    stopSearch()
    resetSearchState({ keepQuery: true })
  }, [resetSearchState, stopSearch])

  const performSearch = useCallback(
    (text: string, options?: Electron.FindInPageOptions) => {
      const target = webviewRef.current ?? attachedWebviewRef.current
      if (!target) {
        logger.debug('Skip performSearch: webview not attached')
        return
      }
      if (!text) {
        stopSearch()
        resetSearchState({ keepQuery: true })
        return
      }
      try {
        target.findInPage(text, options)
      } catch (error) {
        logger.error('findInPage failed', { error })
        window.toast?.error(t('common.error'))
      }
    },
    [resetSearchState, stopSearch, t, webviewRef]
  )

  const handleFoundInPage = useCallback((event: Event & { result?: FoundInPageResult }) => {
    if (!event.result) return

    const { activeMatchOrdinal, matches } = event.result

    if (matches !== undefined) {
      setMatchCount(matches)
    }

    if (activeMatchOrdinal !== undefined) {
      setActiveIndex(activeMatchOrdinal)
    }
  }, [])

  const openSearch = useCallback(() => {
    if (!isWebviewReady || !webviewRef.current) {
      logger.debug('Skip openSearch: webview not ready')
      return
    }
    setIsVisible(true)
    focusInput()
  }, [focusInput, isWebviewReady, webviewRef])

  const goToNext = useCallback(() => {
    if (!query) return
    performSearch(query, { forward: true, findNext: true })
  }, [performSearch, query])

  const goToPrevious = useCallback(() => {
    if (!query) return
    performSearch(query, { forward: false, findNext: true })
  }, [performSearch, query])

  useEffect(() => {
    const nextWebview = webviewRef.current ?? null
    if (currentWebview === nextWebview) return
    setCurrentWebview(nextWebview)
  })

  useEffect(() => {
    const target = currentWebview
    if (!target) {
      attachedWebviewRef.current = null
      return
    }

    const handle = handleFoundInPage
    attachedWebviewRef.current = target
    target.addEventListener('found-in-page', handle)

    return () => {
      target.removeEventListener('found-in-page', handle)
      if (attachedWebviewRef.current === target) {
        try {
          target.stopFindInPage('clearSelection')
        } catch (error) {
          logger.error('stopFindInPage failed', { error })
        }
        attachedWebviewRef.current = null
      }
    }
  }, [currentWebview, handleFoundInPage])

  useEffect(() => {
    if (!isVisible) return
    focusInput()
  }, [focusInput, isVisible])

  useEffect(() => {
    if (!isVisible) return
    if (!query) {
      performSearch('')
      return
    }
    performSearch(query)
  }, [currentWebview, isVisible, performSearch, query])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        openSearch()
        return
      }

      if (!isVisible) return

      if (event.key === 'Escape') {
        event.preventDefault()
        closeSearch()
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        if (event.shiftKey) {
          goToPrevious()
        } else {
          goToNext()
        }
      }
    }

    window.addEventListener('keydown', handleKeydown, true)
    return () => {
      window.removeEventListener('keydown', handleKeydown, true)
    }
  }, [closeSearch, goToNext, goToPrevious, isVisible, openSearch])

  useEffect(() => {
    if (!isWebviewReady) {
      setIsVisible(false)
      resetSearchState()
      stopSearch()
      return
    }
  }, [isWebviewReady, resetSearchState, stopSearch])

  useEffect(() => {
    if (!appId) return
    if (lastAppIdRef.current === appId) return
    lastAppIdRef.current = appId
    setIsVisible(false)
    resetSearchState()
    stopSearch()
  }, [appId, resetSearchState, stopSearch])

  useEffect(() => {
    return () => {
      stopSearch()
      if (focusFrameRef.current !== null) {
        window.cancelAnimationFrame(focusFrameRef.current)
        focusFrameRef.current = null
      }
    }
  }, [stopSearch])

  if (!isVisible) {
    return null
  }

  const matchLabel = `${matchCount > 0 ? Math.max(activeIndex, 1) : 0}/${matchCount}`
  const noResultTitle = matchCount === 0 && query ? t('common.no_results') : undefined
  const disableNavigation = !query || matchCount === 0

  return (
    <div className="pointer-events-auto absolute top-3 right-3 z-50 flex items-center gap-2 rounded-xl border border-default-200 bg-background px-2 py-1 shadow-lg">
      <Input
        ref={inputRef}
        autoFocus
        value={query}
        onValueChange={setQuery}
        placeholder={t('common.search')}
        size="sm"
        radius="sm"
        variant="flat"
        classNames={{
          base: 'w-[240px]',
          inputWrapper:
            'h-8 bg-transparent border border-transparent shadow-none hover:border-transparent hover:bg-transparent focus:border-transparent data-[hover=true]:border-transparent data-[focus=true]:border-transparent data-[focus-visible=true]:outline-none data-[focus-visible=true]:ring-0',
          input: 'text-small focus:outline-none focus-visible:outline-none',
          innerWrapper: 'gap-0'
        }}
      />
      <span
        className="min-w-[44px] text-center text-default-500 text-small tabular-nums"
        title={noResultTitle}
        role="status"
        aria-live="polite"
        aria-atomic="true">
        {matchLabel}
      </span>
      <div className="h-4 w-px bg-default-200" />
      <Button
        size="sm"
        variant="light"
        radius="full"
        isIconOnly
        onPress={goToPrevious}
        isDisabled={disableNavigation}
        aria-label="Previous match"
        className="text-default-500 hover:text-default-900">
        <ChevronUp size={16} />
      </Button>
      <Button
        size="sm"
        variant="light"
        radius="full"
        isIconOnly
        onPress={goToNext}
        isDisabled={disableNavigation}
        aria-label="Next match"
        className="text-default-500 hover:text-default-900">
        <ChevronDown size={16} />
      </Button>
      <div className="h-4 w-px bg-default-200" />
      <Button
        size="sm"
        variant="light"
        radius="full"
        isIconOnly
        onPress={closeSearch}
        aria-label={t('common.close')}
        className="text-default-500 hover:text-default-900">
        <X size={16} />
      </Button>
    </div>
  )
}

export default WebviewSearch
