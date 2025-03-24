import { SearchOutlined } from '@ant-design/icons'
import { Input, Tooltip } from 'antd'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ModelListSearchBarProps {
  onSearch: (text: string) => void
}

/**
 * A collapsible search bar for the model list
 * Renders as an icon initially, expands to full search input when clicked
 */
const ModelListSearchBar: React.FC<ModelListSearchBarProps> = ({ onSearch }) => {
  const { t } = useTranslation()
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchText, setSearchText] = useState('')

  const handleTextChange = (text: string) => {
    setSearchText(text)
    onSearch(text)
  }

  const handleClear = () => {
    setSearchText('')
    setSearchVisible(false)
    onSearch('')
  }

  return searchVisible ? (
    <Input
      type="text"
      placeholder={t('models.search')}
      size="small"
      style={{ width: '160px' }}
      suffix={<SearchOutlined style={{ color: 'var(--color-text-3)' }} />}
      onChange={(e) => handleTextChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          handleTextChange('')
          if (!searchText) setSearchVisible(false)
        }
      }}
      onBlur={() => {
        if (!searchText) setSearchVisible(false)
      }}
      autoFocus
      allowClear
      onClear={handleClear}
    />
  ) : (
    <Tooltip title={t('models.search')} mouseEnterDelay={0.5}>
      <SearchOutlined onClick={() => setSearchVisible(true)} />
    </Tooltip>
  )
}

export default ModelListSearchBar
