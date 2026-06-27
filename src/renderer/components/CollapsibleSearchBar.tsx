import { Input, Tooltip } from '@cherrystudio/ui'
import i18n from '@renderer/i18n'
import { Search, X } from 'lucide-react'
import { motion } from 'motion/react'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'

interface CollapsibleSearchBarProps {
  onSearch: (text: string) => void
  placeholder?: string
  tooltip?: string
  icon?: React.ReactNode
  maxWidth?: string | number
  collapsedSize?: number
  animated?: boolean
  inputClassName?: string
  expandedIconPosition?: 'left' | 'right'
  style?: React.CSSProperties
}

/**
 * A collapsible search bar for list headers
 * Renders as an icon initially, expands to full search input when clicked
 */
const CollapsibleSearchBar = ({
  onSearch,
  placeholder = i18n.t('common.search'),
  tooltip = i18n.t('common.search'),
  icon = <Search size={14} color="var(--color-icon)" />,
  maxWidth = '100%',
  collapsedSize = 32,
  animated = true,
  inputClassName,
  expandedIconPosition = 'right',
  style
}: CollapsibleSearchBarProps) => {
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleTextChange = useCallback(
    (text: string) => {
      setSearchText(text)
      onSearch(text)
    },
    [onSearch]
  )

  const handleClear = useCallback(() => {
    setSearchText('')
    setSearchVisible(false)
    onSearch('')
  }, [onSearch])

  useEffect(() => {
    if (searchVisible && inputRef.current) {
      inputRef.current.focus()
    }
  }, [searchVisible])

  return (
    <motion.div
      initial={false}
      animate={searchVisible ? 'expanded' : 'collapsed'}
      variants={{
        expanded: { width: maxWidth, transition: { duration: animated ? 0.3 : 0, ease: 'easeInOut' } },
        collapsed: { width: collapsedSize, transition: { duration: animated ? 0.3 : 0, ease: 'easeInOut' } }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        position: 'relative',
        height: collapsedSize,
        minWidth: 0,
        overflow: 'hidden',
        flexShrink: searchVisible ? 1 : 0
      }}>
      <motion.div
        initial={false}
        animate={searchVisible ? 'expanded' : 'collapsed'}
        variants={{
          expanded: { width: '100%', opacity: 1, transition: { duration: animated ? 0.3 : 0, ease: 'easeInOut' } },
          collapsed: { width: 0, opacity: 0, transition: { duration: animated ? 0.3 : 0, ease: 'easeInOut' } }
        }}
        style={{ overflow: 'hidden', flexShrink: 1 }}>
        <div className="relative flex items-center">
          {expandedIconPosition === 'left' && (
            <button
              type="button"
              aria-label={tooltip}
              className="-translate-y-1/2 absolute top-1/2 left-2 flex size-4 items-center justify-center text-muted-foreground hover:text-foreground"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => inputRef.current?.focus()}>
              {icon}
            </button>
          )}
          <Input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={searchText}
            autoFocus
            className={`h-8 rounded-full text-sm shadow-none focus-visible:border-border-hover focus-visible:ring-0 ${expandedIconPosition === 'left' ? 'pr-8 pl-8' : 'pr-8'} ${inputClassName ?? ''}`}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                handleTextChange('')
                if (!searchText) setSearchVisible(false)
              }
            }}
            onBlur={() => {
              if (!searchText) setSearchVisible(false)
            }}
            style={{ width: '100%', height: collapsedSize, ...style }}
          />
          {(searchText || expandedIconPosition === 'right') && (
            <button
              type="button"
              aria-label={searchText ? i18n.t('common.clear') : tooltip}
              className="absolute right-2 flex size-4 items-center justify-center text-muted-foreground hover:text-foreground"
              onMouseDown={(e) => e.preventDefault()}
              onClick={searchText ? handleClear : () => inputRef.current?.focus()}>
              {searchText ? <X size={14} /> : icon}
            </button>
          )}
        </div>
      </motion.div>
      <motion.div
        initial={false}
        animate={searchVisible ? 'hidden' : 'visible'}
        className="rounded-lg transition-colors hover:bg-accent"
        variants={{
          visible: {
            opacity: 1,
            transition: { duration: animated ? 0.1 : 0, delay: animated ? 0.3 : 0, ease: 'easeInOut' }
          },
          hidden: { opacity: 0, transition: { duration: animated ? 0.1 : 0, ease: 'easeInOut' } }
        }}
        style={{
          position: 'absolute',
          right: 0,
          width: collapsedSize,
          height: collapsedSize,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: searchVisible ? 'none' : 'auto'
        }}
        onClick={() => setSearchVisible(true)}>
        <Tooltip content={tooltip} delay={500}>
          {icon}
        </Tooltip>
      </motion.div>
    </motion.div>
  )
}

export default memo(CollapsibleSearchBar)
