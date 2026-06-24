import { RefreshIcon } from '@renderer/components/Icons'
import { useTimer } from '@renderer/hooks/useTimer'
import { ipcApi } from '@renderer/ipc'
import { cn } from '@renderer/utils/style'
import { CircleX, Copy, Loader2, Pause } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
interface FooterProps {
  content?: string
  loading?: boolean
  onPause?: () => void
  onRegenerate?: () => void
}

const WindowFooter: FC<FooterProps> = ({
  content = '',
  loading = false,
  onPause = undefined,
  onRegenerate = undefined
}) => {
  const { t } = useTranslation()

  const [isWindowFocus, setIsWindowFocus] = useState(true)
  const [isCopyHovered, setIsCopyHovered] = useState(false)
  const [isEscHovered, setIsEscHovered] = useState(false)
  const [isRegenerateHovered, setIsRegenerateHovered] = useState(false)
  const [isContainerHovered, setIsContainerHovered] = useState(false)
  const [isShowMe, setIsShowMe] = useState(true)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const { setTimeoutTimer } = useTimer()

  useEffect(() => {
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('blur', handleWindowBlur)
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    hideTimerRef.current = setTimeout(() => {
      setIsShowMe(false)
      hideTimerRef.current = null
    }, 3000)

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
      }
    }
  }, [])

  const showMePeriod = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
    }

    setIsShowMe(true)
    hideTimerRef.current = setTimeout(() => {
      setIsShowMe(false)
      hideTimerRef.current = null
    }, 2000)
  }

  useHotkeys('c', () => {
    showMePeriod()
    handleCopy()
  })

  useHotkeys('r', () => {
    showMePeriod()
    handleRegenerate()
  })

  useHotkeys('esc', () => {
    showMePeriod()
    handleEsc()
  })

  const handleEsc = () => {
    setIsEscHovered(true)
    setTimeoutTimer(
      'handleEsc',
      () => {
        setIsEscHovered(false)
      },
      200
    )

    if (loading && onPause) {
      onPause()
    } else {
      void ipcApi.request('window.close')
    }
  }

  const handleRegenerate = () => {
    setIsRegenerateHovered(true)
    setTimeoutTimer(
      'handleRegenerate_1',
      () => {
        setIsRegenerateHovered(false)
      },
      200
    )

    if (loading && onPause) {
      onPause()
    }

    if (onRegenerate) {
      //wait for a little time
      setTimeoutTimer(
        'handleRegenerate_2',
        () => {
          onRegenerate()
        },
        200
      )
    }
  }

  const handleCopy = () => {
    if (!content || loading) return

    navigator.clipboard
      .writeText(content)
      .then(() => {
        window.toast.success(t('message.copy.success'))
        setIsCopyHovered(true)
        setTimeoutTimer(
          'handleCopy',
          () => {
            setIsCopyHovered(false)
          },
          200
        )
      })
      .catch(() => {
        window.toast.error(t('message.copy.failed'))
      })
  }

  const handleWindowFocus = () => {
    setIsWindowFocus(true)
  }

  const handleWindowBlur = () => {
    setIsWindowFocus(false)
  }

  const footerButtonClassName = (enabled: boolean, hovered: boolean) =>
    cn(
      'flex h-[22px] cursor-pointer select-none flex-row items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted px-2 text-foreground-secondary text-xs transition-colors',
      enabled ? 'opacity-100' : 'opacity-20',
      hovered && 'text-primary [&_.btn-icon]:text-primary',
      'hover:text-primary hover:[&_.btn-icon]:text-primary'
    )

  return (
    <div
      onMouseEnter={() => setIsContainerHovered(true)}
      onMouseLeave={() => setIsContainerHovered(false)}
      className={cn(
        '-translate-x-1/2 absolute bottom-0 left-1/2 flex h-8 w-[calc(100%-16px)] min-w-min max-w-[480px] flex-row items-center justify-center rounded-lg px-2 py-1.5 backdrop-blur-sm transition-all duration-300',
        isShowMe || isContainerHovered ? 'opacity-100' : 'opacity-0'
      )}>
      <div className="flex flex-row items-center justify-center gap-1.5 text-foreground-secondary text-xs">
        <button type="button" onClick={handleEsc} className={footerButtonClassName(isWindowFocus, isEscHovered)}>
          {loading ? (
            <>
              <span className="relative size-4">
                <Pause size={14} className="btn-icon absolute top-px left-px text-error-base" />
                <Loader2 className="btn-icon absolute top-0 left-0 size-4 animate-spin text-error-base" />
              </span>
              {t('selection.action.window.esc_stop')}
            </>
          ) : (
            <>
              <CircleX size={14} className="btn-icon" />
              {t('selection.action.window.esc_close')}
            </>
          )}
        </button>
        {onRegenerate && (
          <button
            type="button"
            onClick={handleRegenerate}
            className={footerButtonClassName(isWindowFocus, isRegenerateHovered)}>
            <RefreshIcon size={14} className="btn-icon" />
            {t('selection.action.window.r_regenerate')}
          </button>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className={footerButtonClassName(isWindowFocus && !!content, isCopyHovered)}>
          <Copy size={14} className="btn-icon" />
          {t('selection.action.window.c_copy')}
        </button>
      </div>
    </div>
  )
}

export default WindowFooter
