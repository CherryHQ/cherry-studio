import '@renderer/assets/styles/CommandListPopover.scss'

import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { SuggestionProps } from '@tiptap/suggestion'
import { Typography } from 'antd'
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Command } from './command'

const { Text } = Typography

export interface CommandListPopoverProps extends SuggestionProps<Command> {
  ref?: React.RefObject<CommandListPopoverRef | null>
}

export interface CommandListPopoverRef extends SuggestionProps<Command> {
  updateSelectedIndex: (index: number) => void
  selectCurrent: () => void
  onKeyDown: (event: KeyboardEvent) => boolean
}

const CommandListPopover = ({
  ref,
  ...props
}: SuggestionProps<Command> & { ref?: React.RefObject<CommandListPopoverRef | null> }) => {
  const { items, command } = props
  const [internalSelectedIndex, setInternalSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const virtualListRef = useRef<DynamicVirtualListRef>(null)
  const { t } = useTranslation()

  // Helper function to get translated text with fallback
  const getTranslatedCommand = useCallback(
    (item: Command, field: 'title' | 'description') => {
      const key = `richEditor.commands.${item.id}.${field}`
      const translated = t(key)
      return translated === key ? item[field] : translated
    },
    [t]
  )

  // Reset selected index when items change
  useEffect(() => {
    setInternalSelectedIndex(0)
  }, [items])

  // Auto scroll to selected item using virtual list
  useEffect(() => {
    if (virtualListRef.current && items.length > 0) {
      virtualListRef.current.scrollToIndex(internalSelectedIndex, {
        align: 'auto'
      })
    }
  }, [internalSelectedIndex, items.length])

  const selectItem = useCallback(
    (index: number) => {
      const item = props.items[index]

      if (item) {
        command({ id: item.id, label: item.title })
      }
    },
    [props.items, command]
  )

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!items.length) return false

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          setInternalSelectedIndex((prev) => (prev === 0 ? items.length - 1 : prev - 1))
          return true

        case 'ArrowDown':
          event.preventDefault()
          setInternalSelectedIndex((prev) => (prev === items.length - 1 ? 0 : prev + 1))
          return true

        case 'Enter':
          event.preventDefault()
          if (items[internalSelectedIndex]) {
            selectItem(internalSelectedIndex)
          }
          return true

        case 'Escape':
          event.preventDefault()
          return true

        default:
          return false
      }
    },
    [items, internalSelectedIndex, selectItem]
  )

  // Expose methods via ref
  useImperativeHandle(
    ref,
    () => ({
      ...props,
      updateSelectedIndex: (index: number) => setInternalSelectedIndex(index),
      selectCurrent: () => selectItem(internalSelectedIndex),
      onKeyDown: handleKeyDown
    }),
    [handleKeyDown, props, internalSelectedIndex, selectItem]
  )

  // Get theme from context
  const { theme } = useTheme()

  // Get background and selected colors that work with both light and dark themes
  const colors = useMemo(() => {
    const isDark = theme === 'dark'
    return {
      background: isDark ? 'var(--color-background-soft, #222222)' : 'white',
      border: isDark ? 'var(--color-border, #ffffff19)' : '#e1e5e9',
      selectedBackground: isDark ? 'var(--color-hover, rgba(40, 40, 40, 1))' : '#f0f0f0',
      boxShadow: isDark ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.1)'
    }
  }, [theme])

  // Handle mouse enter for hover effect
  const handleItemMouseEnter = useCallback((index: number) => {
    setInternalSelectedIndex(index)
  }, [])

  // Estimate size for virtual list items
  const estimateSize = useCallback(() => 50, []) // Estimated height per item

  // Render virtual list item
  const renderVirtualItem = useCallback(
    (item: Command, index: number) => {
      return (
        <div
          key={item.id}
          data-index={index}
          style={{
            padding: '10px 16px',
            cursor: 'pointer',
            backgroundColor: index === internalSelectedIndex ? colors.selectedBackground : 'transparent',
            border: 'none',
            transition: 'all 0.15s ease',
            borderRadius: '4px',
            margin: '2px',
            minHeight: '46px', // Ensure consistent height for virtual list
            display: 'flex',
            alignItems: 'center'
          }}
          onClick={() => selectItem(index)}
          onMouseEnter={() => handleItemMouseEnter(index)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
            <div
              style={{
                width: '20px',
                height: '20px',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
              <item.icon size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text strong style={{ fontSize: '14px', display: 'block', lineHeight: '20px' }}>
                {getTranslatedCommand(item, 'title')}
              </Text>
              <Text type="secondary" style={{ fontSize: '12px', lineHeight: '16px' }}>
                {getTranslatedCommand(item, 'description')}
              </Text>
            </div>
          </div>
        </div>
      )
    },
    [internalSelectedIndex, colors.selectedBackground, selectItem, handleItemMouseEnter, getTranslatedCommand]
  )

  const style: React.CSSProperties = {
    background: colors.background,
    border: `1px solid ${colors.border}`,
    borderRadius: '6px',
    boxShadow: colors.boxShadow,
    maxHeight: '280px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
  }

  return (
    <div ref={listRef} style={style} className="command-list-popover">
      {items.length === 0 ? (
        <div style={{ padding: '12px', color: '#999', textAlign: 'center', fontSize: '14px' }}>
          {t('richEditor.commands.noCommandsFound')}
        </div>
      ) : (
        <DynamicVirtualList
          ref={virtualListRef}
          list={items}
          estimateSize={estimateSize}
          size="100%"
          children={renderVirtualItem}
          scrollerStyle={{
            overflow: 'auto'
          }}
        />
      )}
    </div>
  )
}

CommandListPopover.displayName = 'CommandListPopover'

export default CommandListPopover
