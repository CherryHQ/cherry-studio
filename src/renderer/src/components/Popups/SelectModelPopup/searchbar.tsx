import { HStack } from '@renderer/components/Layout'
import { Input, InputRef } from 'antd'
import { Search } from 'lucide-react'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface SelectModelSearchBarProps {
  onSearch: (text: string) => void
}

const SelectModelSearchBar: React.FC<SelectModelSearchBarProps> = ({ onSearch }) => {
  const { t } = useTranslation()
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
    onSearch('')
  }, [onSearch])

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [])

  return (
    <HStack style={{ padding: '0 12px', marginTop: 5 }}>
      <Input
        prefix={
          <SearchIcon>
            <Search size={15} />
          </SearchIcon>
        }
        ref={inputRef}
        placeholder={t('models.search')}
        value={searchText}
        onChange={(e) => handleTextChange(e.target.value)}
        onClear={handleClear}
        allowClear
        autoFocus
        spellCheck={false}
        style={{ paddingLeft: 0 }}
        variant="borderless"
        size="middle"
        onKeyDown={(e) => {
          // 防止上下键移动光标
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter') {
            e.preventDefault()
          }
        }}
      />
    </HStack>
  )
}

const SearchIcon = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background-soft);
  margin-right: 2px;
`

export default memo(SelectModelSearchBar)
