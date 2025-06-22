import { SearchOutlined } from '@ant-design/icons'
import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { switchTab } from '@renderer/store/tabs'
import { Tab } from '@renderer/store/tabs'
import { Input, Modal } from 'antd'
import { AnimatePresence, motion } from 'framer-motion'
import Fuse from 'fuse.js'
import { FileSearch, Folder, Languages, LayoutGrid, MessageSquare, Palette, Settings, Sparkle } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface TabSearchModalProps {
  visible: boolean
  onClose: () => void
}

const TabSearchModal: React.FC<TabSearchModalProps> = ({ visible, onClose }) => {
  const dispatch = useAppDispatch()
  const { tabs } = useAppSelector((state) => state.tabs)
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<any>(null)

  // Initialize Fuse.js for fuzzy search
  const fuse = useMemo(() => {
    return new Fuse(tabs, {
      keys: ['title', 'route', 'minapp.name'],
      threshold: 0.4,
      includeScore: true,
      findAllMatches: true,
      ignoreLocation: true
    })
  }, [tabs])

  // Perform search
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) {
      // Show recent tabs when no search query
      return [...tabs]
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        .slice(0, 10)
        .map((tab) => ({ item: tab, score: 0 }))
    }
    return fuse.search(searchQuery)
  }, [searchQuery, fuse, tabs])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, searchResults.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (searchResults[selectedIndex]) {
            dispatch(switchTab(searchResults[selectedIndex].item.id))
            onClose()
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [selectedIndex, searchResults, dispatch, onClose]
  )

  // Reset state when modal opens/closes
  useEffect(() => {
    if (visible) {
      setSearchQuery('')
      setSelectedIndex(0)
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [visible])

  // Get icon for tab
  const getTabIcon = (tab: Tab) => {
    if (tab.type === 'minapp' && tab.minapp) {
      return <MinAppIcon size={20} app={tab.minapp} style={{ borderRadius: 4 }} />
    }

    const iconMap: Record<string, React.ReactNode> = {
      '/': <MessageSquare size={18} />,
      '/agents': <Sparkle size={18} />,
      '/paintings': <Palette size={18} />,
      '/translate': <Languages size={18} />,
      '/files': <Folder size={18} />,
      '/knowledge': <FileSearch size={18} />,
      '/apps': <LayoutGrid size={18} />,
      '/settings': <Settings size={18} />
    }

    const routePrefix = tab.route?.split('/')[1]
    return iconMap[tab.route || ''] || iconMap[`/${routePrefix}`] || <MessageSquare size={18} />
  }

  const handleTabClick = (tabId: string) => {
    dispatch(switchTab(tabId))
    onClose()
  }

  return (
    <StyledModal open={visible} onCancel={onClose} footer={null} width={600} centered closable={false} maskClosable>
      <SearchContainer>
        <SearchInputWrapper>
          <SearchOutlined style={{ fontSize: 20, color: 'var(--color-text-3)' }} />
          <StyledInput
            ref={inputRef}
            placeholder={t('tabs.searchPlaceholder') || 'Search tabs...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            bordered={false}
            autoFocus
          />
          <ShortcutHint>ESC</ShortcutHint>
        </SearchInputWrapper>

        <TabsList>
          <AnimatePresence mode="wait">
            {searchResults.length > 0 ? (
              searchResults.map((result, index) => (
                <motion.div
                  key={result.item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15, delay: index * 0.02 }}>
                  <TabItem
                    isSelected={index === selectedIndex}
                    onClick={() => handleTabClick(result.item.id)}
                    onMouseEnter={() => setSelectedIndex(index)}>
                    <TabIcon>{getTabIcon(result.item)}</TabIcon>
                    <TabInfo>
                      <TabTitle>{result.item.title}</TabTitle>
                      {result.item.route && <TabPath>{result.item.route}</TabPath>}
                    </TabInfo>
                    {result.item.isPinned && <PinnedBadge>📌</PinnedBadge>}
                    {result.score !== undefined && result.score > 0 && (
                      <MatchScore>{Math.round((1 - result.score) * 100)}%</MatchScore>
                    )}
                  </TabItem>
                </motion.div>
              ))
            ) : (
              <EmptyState>
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2 }}>
                  <EmptyIcon>🔍</EmptyIcon>
                  <EmptyText>{t('tabs.noResults') || 'No tabs found'}</EmptyText>
                </motion.div>
              </EmptyState>
            )}
          </AnimatePresence>
        </TabsList>

        <HelpText>
          <HelpItem>
            <kbd>↑↓</kbd> Navigate
          </HelpItem>
          <HelpItem>
            <kbd>Enter</kbd> Open
          </HelpItem>
          <HelpItem>
            <kbd>Esc</kbd> Close
          </HelpItem>
        </HelpText>
      </SearchContainer>
    </StyledModal>
  )
}

const StyledModal = styled(Modal)`
  .ant-modal-content {
    background: var(--color-background-soft);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    padding: 0;
    overflow: hidden;
  }
`

const SearchContainer = styled.div`
  display: flex;
  flex-direction: column;
`

const SearchInputWrapper = styled.div`
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  gap: 12px;
`

const StyledInput = styled(Input)`
  flex: 1;
  font-size: 18px;
  background: transparent;

  &::placeholder {
    color: var(--color-text-3);
  }

  .ant-input {
    background: transparent;
    font-size: 18px;
  }
`

const ShortcutHint = styled.span`
  padding: 4px 8px;
  background: var(--color-background-mute);
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-text-3);
  font-family: monospace;
`

const TabsList = styled.div`
  max-height: 400px;
  overflow-y: auto;
  padding: 8px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 3px;
  }
`

const TabItem = styled.div<{ isSelected: boolean }>`
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  gap: 12px;
  background: ${({ isSelected }) => (isSelected ? 'var(--color-background-hover)' : 'transparent')};
  border: 1px solid ${({ isSelected }) => (isSelected ? 'var(--color-primary)' : 'transparent')};
  transition: all 0.15s ease;

  &:hover {
    background: var(--color-background-hover);
  }
`

const TabIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--color-text-2);
`

const TabInfo = styled.div`
  flex: 1;
  overflow: hidden;
`

const TabTitle = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const TabPath = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 2px;
`

const PinnedBadge = styled.span`
  font-size: 12px;
`

const MatchScore = styled.span`
  padding: 2px 8px;
  background: var(--color-primary-bg);
  color: var(--color-primary);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
`

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
`

const EmptyIcon = styled.div`
  font-size: 48px;
  margin-bottom: 12px;
`

const EmptyText = styled.div`
  font-size: 14px;
  color: var(--color-text-3);
`

const HelpText = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 12px;
  border-top: 1px solid var(--color-border);
  background: var(--color-background);
`

const HelpItem = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-3);

  kbd {
    padding: 2px 6px;
    background: var(--color-background-soft);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-family: monospace;
    font-size: 11px;
  }
`

export default TabSearchModal
