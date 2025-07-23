import { LoadingOutlined } from '@ant-design/icons'
import { CircleX, Copy, Pause, RefreshCw } from 'lucide-react'
import { FC, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
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
    setTimeout(() => {
      setIsEscHovered(false)
    }, 200)

    if (loading && onPause) {
      onPause()
    } else {
      window.api.selection.closeActionWindow()
    }
  }

  const handleRegenerate = () => {
    setIsRegenerateHovered(true)
    setTimeout(() => {
      setIsRegenerateHovered(false)
    }, 200)

    if (loading && onPause) {
      onPause()
    }

    if (onRegenerate) {
      //wait for a little time
      setTimeout(() => {
        onRegenerate()
      }, 200)
    }
  }

  const handleCopy = () => {
    if (!content || loading) return

    navigator.clipboard
      .writeText(content)
      .then(() => {
        window.message.success(t('message.copy.success'))
        setIsCopyHovered(true)
        setTimeout(() => {
          setIsCopyHovered(false)
        }, 200)
      })
      .catch(() => {
        window.message.error(t('message.copy.failed'))
      })
  }

  const handleWindowFocus = () => {
    setIsWindowFocus(true)
  }

  const handleWindowBlur = () => {
    setIsWindowFocus(false)
  }

  return (
    <Container
      onMouseEnter={() => setIsContainerHovered(true)}
      onMouseLeave={() => setIsContainerHovered(false)}
      $isHovered={isContainerHovered}
      $showInitially={isShowMe}>
      <OpButtonWrapper>
        <OpButton onClick={handleEsc} $isWindowFocus={isWindowFocus} data-hovered={isEscHovered}>
          {loading ? (
            <>
              <LoadingIconWrapper>
                <Pause size={14} className="btn-icon loading-icon" style={{ position: 'absolute', left: 1, top: 1 }} />
                <LoadingOutlined
                  style={{ fontSize: 16, position: 'absolute', left: 0, top: 0 }}
                  className="btn-icon  loading-icon"
                  spin
                />
              </LoadingIconWrapper>
              {t('selection.action.window.esc_stop')}
            </>
          ) : (
            <>
              <CircleX size={14} className="btn-icon" />
              {t('selection.action.window.esc_close')}
            </>
          )}
        </OpButton>
        {onRegenerate && (
          <OpButton onClick={handleRegenerate} $isWindowFocus={isWindowFocus} data-hovered={isRegenerateHovered}>
            <RefreshCw size={14} className="btn-icon" />
            {t('selection.action.window.r_regenerate')}
          </OpButton>
        )}
        <OpButton onClick={handleCopy} $isWindowFocus={isWindowFocus && !!content} data-hovered={isCopyHovered}>
          <Copy size={14} className="btn-icon" />
          {t('selection.action.window.c_copy')}
        </OpButton>
      </OpButtonWrapper>
    </Container>
  )
}

const Container = styled.div<{ $isHovered: boolean; $showInitially: boolean }>`
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  max-width: 480px;
  min-width: min-content;
  width: calc(100% - 16px);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: 5px 8px;
  height: 32px;
  backdrop-filter: blur(8px);
  border-radius: 8px;
  opacity: ${(props) => (props.$showInitially ? 1 : 0)};
  transition: all 0.3s ease;

  &:hover {
    opacity: 1;
  }
`

const OpButtonWrapper = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  font-size: 12px;
  gap: 6px;
`

const OpButton = styled.div<{ $isWindowFocus: boolean; $isHovered?: boolean }>`
  cursor: pointer;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border-radius: 4px;
  background-color: var(--color-background-mute);
  color: var(--color-text-secondary);
  height: 22px;
  opacity: ${(props) => (props.$isWindowFocus ? 1 : 0.2)};
  transition: opacity 0.3s ease;
  transition: color 0.2s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;

  .btn-icon {
    color: var(--color-text-secondary);
  }

  .loading-icon {
    color: var(--color-error);
  }

  &:hover,
  &[data-hovered='true'] {
    color: var(--color-primary) !important;

    .btn-icon {
      color: var(--color-primary) !important;
      transition: color 0.2s ease;
    }
  }
`

const LoadingIconWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 16px;
  height: 16px;
`

export default WindowFooter
