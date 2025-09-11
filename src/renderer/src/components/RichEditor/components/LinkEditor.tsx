import { useTheme } from '@renderer/context/ThemeProvider'
import { Button, Flex, Input } from 'antd'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface LinkEditorProps {
  /** Whether the editor is visible */
  visible: boolean
  /** Position for the popup */
  position: { x: number; y: number } | null
  /** Link attributes */
  link: { href: string; text: string }
  /** Callback when the user saves the link */
  onSave: (href: string, text: string) => void
  /** Callback when the user removes the link */
  onRemove: () => void
  /** Callback when the editor is closed without saving */
  onCancel: () => void
  /** Whether to show remove button */
  showRemove?: boolean
}

/**
 * Inline link editor that appears on hover over links
 * Provides input fields for editing link URL and title
 */
const LinkEditor: React.FC<LinkEditorProps> = ({
  visible,
  position,
  link,
  onSave,
  onRemove,
  onCancel,
  showRemove = true
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [href, setHref] = useState<string>(link.href || '')
  const [text, setText] = useState<string>(link.text || '')
  const containerRef = useRef<HTMLDivElement>(null)
  const hrefInputRef = useRef<any>(null)

  // Reset values when link changes
  useEffect(() => {
    if (visible) {
      setHref(link.href || '')
      setText(link.text || '')
    }
  }, [visible, link.href, link.text])

  // Auto-focus href input when dialog opens
  useEffect(() => {
    if (visible && hrefInputRef.current) {
      setTimeout(() => {
        hrefInputRef.current?.focus()
      }, 100)
    }
  }, [visible])

  // Handle clicks outside to close
  useEffect(() => {
    if (!visible) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // Don't close if clicking within the editor or on a link
      if (containerRef.current?.contains(target) || target.closest('a[href]') || target.closest('[data-link-editor]')) {
        return
      }

      onCancel()
    }

    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [visible, onCancel])

  const handleSave = useCallback(() => {
    const trimmedHref = href.trim()
    const trimmedText = text.trim()
    if (trimmedHref && trimmedText) {
      onSave(trimmedHref, trimmedText)
    }
  }, [href, text, onSave])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSave()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    },
    [handleSave, onCancel]
  )

  if (!visible || !position) return null

  // Theme-aware styles
  const isDark = theme === 'dark'
  const styles: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y + 25, // Position slightly below the link
    zIndex: 1000,
    background: isDark ? 'var(--color-background-soft, #222222)' : 'white',
    border: `1px solid ${isDark ? 'var(--color-border, #ffffff19)' : '#d9d9d9'}`,
    borderRadius: 8,
    boxShadow: isDark ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0,0,0,0.15)',
    padding: 12,
    width: 320,
    maxWidth: '90vw'
  }

  return (
    <div style={styles} ref={containerRef} data-link-editor onKeyDown={handleKeyDown}>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
          {t('richEditor.link.text')}
        </label>
        <Input
          ref={hrefInputRef}
          value={text}
          placeholder={t('richEditor.link.textPlaceholder')}
          onChange={(e) => setText(e.target.value)}
          size="small"
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
          {t('richEditor.link.url')}
        </label>
        <Input value={href} placeholder="https://example.com" onChange={(e) => setHref(e.target.value)} size="small" />
      </div>

      <Flex justify="space-between" align="center">
        <div>
          {showRemove && (
            <Button size="small" danger type="text" onClick={onRemove} style={{ padding: '0 8px' }}>
              {t('richEditor.link.remove')}
            </Button>
          )}
        </div>
        <Flex gap={6}>
          <Button size="small" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="primary" size="small" onClick={handleSave} disabled={!href.trim() || !text.trim()}>
            {t('common.save')}
          </Button>
        </Flex>
      </Flex>
    </div>
  )
}

export default LinkEditor
