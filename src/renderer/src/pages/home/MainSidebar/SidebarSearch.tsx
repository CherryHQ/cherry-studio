import { Input, InputRef } from 'antd'
import { Search } from 'lucide-react'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { MainMenuItem, MainMenuItemIcon, MainMenuItemLeft, MainMenuItemText } from './MainSidebarStyles'

interface SidebarSearchProps {
  onSearch: (text: string) => void
}

const SidebarSearch: React.FC<SidebarSearchProps> = ({ onSearch }) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<InputRef>(null)

  const handleTextChange = useCallback(
    (text: string) => {
      setSearchText(text)
      onSearch(text)
    },
    [onSearch]
  )

  const handleExpand = useCallback(() => {
    setIsExpanded(true)
  }, [])

  const handleClear = useCallback(() => {
    setSearchText('')
    onSearch('')
  }, [onSearch])

  const handleCollapse = useCallback(() => {
    setSearchText('')
    setIsExpanded(false)
    onSearch('')
  }, [onSearch])

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCollapse()
      }
    },
    [handleCollapse]
  )

  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isExpanded])

  const renderInputBox = useMemo(() => {
    return (
      <Input
        ref={inputRef}
        value={searchText}
        placeholder={t('chat.assistant.search.placeholder')}
        onChange={(e) => handleTextChange(e.target.value)}
        onKeyDown={handleInputKeyDown}
        onBlur={(e) => {
          // 如果输入框失焦且没有搜索内容，则收起
          if (!e.target.value.trim()) {
            handleCollapse()
          }
        }}
        onClear={handleClear}
        allowClear
        style={{
          paddingTop: 4
        }}
        prefix={
          <MainMenuItemIcon style={{ margin: '0 6px 0 -2px' }}>
            <Search size={18} className="icon" />
          </MainMenuItemIcon>
        }
        spellCheck={false}
      />
    )
  }, [handleClear, handleCollapse, handleInputKeyDown, handleTextChange, searchText, t])

  const renderMenuItem = useMemo(() => {
    return (
      <MainMenuItem onClick={handleExpand} style={{ cursor: 'pointer' }}>
        <MainMenuItemLeft>
          <MainMenuItemIcon>
            <Search size={18} className="icon" />
          </MainMenuItemIcon>
          <MainMenuItemText>{t('chat.assistant.search.placeholder')}</MainMenuItemText>
        </MainMenuItemLeft>
      </MainMenuItem>
    )
  }, [handleExpand, t])

  return <SearchBarWrapper>{isExpanded ? renderInputBox : renderMenuItem}</SearchBarWrapper>
}

const SearchBarWrapper = styled.div`
  height: 2.2rem;
`

export default memo(SidebarSearch)
