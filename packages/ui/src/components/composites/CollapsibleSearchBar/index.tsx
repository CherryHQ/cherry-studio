// Original path: src/renderer/src/components/CollapsibleSearchBar.tsx
import type { InputRef } from 'antd'
import { Input } from 'antd'
import { Search } from 'lucide-react'
import { motion } from 'motion/react'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'

import { Tooltip } from '../../primitives/tooltip'

interface CollapsibleSearchBarProps {
  onSearch: (text: string) => void
  placeholder?: string
  tooltip?: string
  icon?: React.ReactNode
  maxWidth?: string | number
  style?: React.CSSProperties
}

/**
 * A collapsible search bar for list headers
 * Renders as an icon initially, expands to full search input when clicked
 */
const CollapsibleSearchBar = ({
  onSearch,
  placeholder = 'Search',
  tooltip = 'Search',
  icon = <Search size={14} color="var(--color-icon)" />,
  maxWidth = '100%',
  style
}: CollapsibleSearchBarProps) => {
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<InputRef>(null)

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
    <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
      <motion.div
        initial="collapsed"
        animate={searchVisible ? 'expanded' : 'collapsed'}
        variants={{
          expanded: { maxWidth: maxWidth, opacity: 1, transition: { duration: 0.3, ease: 'easeInOut' } },
          collapsed: { maxWidth: 0, opacity: 0, transition: { duration: 0.3, ease: 'easeInOut' } }
        }}
        style={{ overflow: 'hidden', flex: 1 }}>
        <Input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          size="small"
          suffix={icon}
          value={searchText}
          autoFocus
          allowClear
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
          onClear={handleClear}
          style={{ width: '100%', ...style }}
        />
      </motion.div>
      <motion.div
        initial="visible"
        animate={searchVisible ? 'hidden' : 'visible'}
        variants={{
          visible: { opacity: 1, transition: { duration: 0.1, delay: 0.3, ease: 'easeInOut' } },
          hidden: { opacity: 0, transition: { duration: 0.1, ease: 'easeInOut' } }
        }}
        style={{ cursor: 'pointer', display: 'flex' }}
        onClick={() => setSearchVisible(true)}>
        <Tooltip content={tooltip} delay={500} closeDelay={0}>
          {icon}
        </Tooltip>
      </motion.div>
    </div>
  )
}

export default memo(CollapsibleSearchBar)
