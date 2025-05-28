import { LoadingOutlined } from '@ant-design/icons'
import { CircleX, Copy, Pause } from 'lucide-react'
import { FC, useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
interface FooterProps {
  content?: string
  loading?: boolean
  onPause?: () => void
}

const WindowFooter: FC<FooterProps> = ({ content = '', loading = false, onPause = () => {} }) => {
  const { t } = useTranslation()

  const [isWindowFocus, setIsWindowFocus] = useState(true)
  const [isCopyHovered, setIsCopyHovered] = useState(false)
  const [isEscHovered, setIsEscHovered] = useState(false)

  useEffect(() => {
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [])

  useHotkeys('c', () => {
    handleCopy()
  })

  useHotkeys('esc', () => {
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

  const handleCopy = () => {
    if (!content) return

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
    <Container>
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
        <OpButton onClick={handleCopy} $isWindowFocus={isWindowFocus && !!content} data-hovered={isCopyHovered}>
          <Copy size={14} className="btn-icon" />
          {t('selection.action.window.c_copy')}
        </OpButton>
      </OpButtonWrapper>
    </Container>
  )
}

const Container = styled.div`
  position: absolute;
  bottom: 0;
  left: 8px;
  right: 8px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: 5px 0;
  height: 32px;
  backdrop-filter: blur(8px);
  border-radius: 8px;
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
