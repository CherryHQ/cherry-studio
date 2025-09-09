import { useTheme } from '@renderer/context/ThemeProvider'
import { Button, Flex, Input } from 'antd'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface MathInputDialogProps {
  /** Whether the dialog is visible */
  visible: boolean
  /** Callback when the user confirms the formula */
  onSubmit: (formula: string) => void
  /** Callback when the dialog is closed without submitting */
  onCancel: () => void
  /** Initial LaTeX value */
  defaultValue?: string
  /** Callback for real-time formula updates */
  onFormulaChange?: (formula: string) => void
  /** Position relative to target element */
  position?: { x: number; y: number; top?: number }
  /** Scroll container reference to prevent scrolling */
  scrollContainer?: React.RefObject<HTMLDivElement | null>
}

/**
 * Simple inline dialog for entering LaTeX formula.
 * Renders a small floating box (similar to the screenshot provided by the user)
 * with a multi-line input and a confirm button.
 */
const MathInputDialog: React.FC<MathInputDialogProps> = ({
  visible,
  onSubmit,
  onCancel,
  defaultValue = '',
  onFormulaChange,
  position,
  scrollContainer
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [value, setValue] = useState<string>(defaultValue)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visible) {
      setValue(defaultValue)
    }
  }, [visible, defaultValue])

  // Prevent scroll container scrolling when dialog is open
  useEffect(() => {
    if (visible && scrollContainer?.current) {
      const scrollElement = scrollContainer.current
      const originalOverflow = scrollElement.style.overflow
      const originalScrollbarGutter = scrollElement.style.scrollbarGutter

      scrollElement.style.overflow = 'hidden'
      scrollElement.style.scrollbarGutter = 'stable'

      return () => {
        if (scrollElement) {
          scrollElement.style.overflow = originalOverflow
          scrollElement.style.scrollbarGutter = originalScrollbarGutter
        }
      }
    }
    return
  }, [visible, scrollContainer])

  useEffect(() => {
    if (visible && containerRef.current) {
      const textarea = containerRef.current.querySelector('textarea') as HTMLTextAreaElement | null
      if (textarea) {
        textarea.focus()
        // Position cursor at the end of the text
        const length = textarea.value.length
        textarea.setSelectionRange(length, length)
      }
    }
  }, [visible])

  if (!visible) return null

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (trimmed) {
      onSubmit(trimmed)
    }
  }

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      handleSubmit()
    }
  }

  const isDark = theme === 'dark'

  const getPositionStyles = (): React.CSSProperties => {
    if (position) {
      const dialogHeight = 200
      const spaceBelow = window.innerHeight - position.y
      const spaceAbove = position.y

      const showAbove = spaceBelow < dialogHeight + 20 && spaceAbove > dialogHeight + 20

      return {
        position: 'fixed',
        // When showing above, use the element's top position for accurate placement
        top: showAbove ? 'auto' : position.y + 10,
        bottom: showAbove ? window.innerHeight - (position.top || position.y) + 10 : 'auto',
        left: position.x,
        transform: 'translateX(-50%)',
        zIndex: 1000
      }
    }

    return {
      position: 'fixed',
      top: '50%',
      left: '50%',
      zIndex: 1000
    }
  }

  const styles: React.CSSProperties = {
    ...getPositionStyles(),
    background: isDark ? 'var(--color-background-soft, #222222)' : 'white',
    border: `1px solid ${isDark ? 'var(--color-border, #ffffff19)' : '#d9d9d9'}`,
    borderRadius: 8,
    boxShadow: isDark ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0,0,0,0.15)',
    padding: 16,
    width: 360,
    maxWidth: '90vw'
  }

  return (
    <div style={styles} ref={containerRef}>
      <Input.TextArea
        value={value}
        rows={4}
        placeholder={t('richEditor.math.placeholder')}
        onChange={(e) => {
          const newValue = e.target.value
          setValue(newValue)
          onFormulaChange?.(newValue)
        }}
        onKeyDown={handleKeyDown}
        style={{ marginBottom: 12, fontFamily: 'monospace' }}
      />
      <Flex justify="flex-end" gap={8}>
        <Button size="small" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="primary" size="small" onClick={handleSubmit}>
          {t('common.confirm')}
        </Button>
      </Flex>
    </div>
  )
}

export default MathInputDialog
