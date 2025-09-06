import { isMac, isWin } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useShortcuts } from '@renderer/hooks/useShortcuts'
import { getShortcutLabel } from '@renderer/i18n/label'
import { Modal } from 'antd'
import { FC, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ShortcutsHelpProps {
  visible: boolean
  onClose: () => void
}

const ShortcutsHelp: FC<ShortcutsHelpProps> = ({ visible, onClose }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { shortcuts } = useShortcuts()
  const [searchTerm, setSearchTerm] = useState('')

  // 过滤和分类快捷键
  const filteredShortcuts = shortcuts.filter(
    (shortcut) =>
      shortcut.enabled &&
      (getShortcutLabel(shortcut.key).toLowerCase().includes(searchTerm.toLowerCase()) ||
        shortcut.key.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  // 按类别分组快捷键
  const categorizedShortcuts = {
    navigation: filteredShortcuts.filter(
      (s) => s.key.includes('tab') || s.key.includes('show') || s.key.includes('toggle')
    ),
    editing: filteredShortcuts.filter(
      (s) => s.key.includes('edit') || s.key.includes('copy') || s.key.includes('delete') || s.key.includes('clear')
    ),
    search: filteredShortcuts.filter((s) => s.key.includes('search')),
    system: filteredShortcuts.filter(
      (s) => s.key.includes('zoom') || s.key.includes('fullscreen') || s.key.includes('mini')
    ),
    other: filteredShortcuts.filter(
      (s) =>
        !s.key.includes('tab') &&
        !s.key.includes('show') &&
        !s.key.includes('toggle') &&
        !s.key.includes('edit') &&
        !s.key.includes('copy') &&
        !s.key.includes('delete') &&
        !s.key.includes('clear') &&
        !s.key.includes('search') &&
        !s.key.includes('zoom') &&
        !s.key.includes('fullscreen') &&
        !s.key.includes('mini')
    )
  }

  const renderShortcutCategory = (title: string, shortcuts: any[]) => {
    if (shortcuts.length === 0) return null

    return (
      <CategorySection>
        <CategoryTitle>{title}</CategoryTitle>
        {shortcuts.map((shortcut) => (
          <ShortcutItem key={shortcut.key}>
            <ShortcutName>{getShortcutLabel(shortcut.key)}</ShortcutName>
            <ShortcutKeys>{getShortcutDisplay(shortcut.key)}</ShortcutKeys>
          </ShortcutItem>
        ))}
      </CategorySection>
    )
  }

  // 格式化快捷键显示文本的辅助函数
  const formatShortcut = (shortcut: string[]) => {
    return shortcut
      .map((key) => {
        switch (key.toLowerCase()) {
          case 'commandorcontrol':
            return isMac ? '⌘' : 'Ctrl'
          case 'ctrl':
            return isMac ? '⌃' : 'Ctrl'
          case 'alt':
            return isMac ? '⌥' : 'Alt'
          case 'meta':
            return isMac ? '⌘' : isWin ? 'Win' : 'Super'
          case 'shift':
            return isMac ? '⇧' : 'Shift'
          case 'arrowup':
            return '↑'
          case 'arrowdown':
            return '↓'
          case 'arrowleft':
            return '←'
          case 'arrowright':
            return '→'
          case 'slash':
            return '/'
          case 'semicolon':
            return ';'
          case 'bracketleft':
            return '['
          case 'bracketright':
            return ']'
          case 'backslash':
            return '\\'
          case 'quote':
            return "'"
          case 'comma':
            return ','
          case 'minus':
            return '-'
          case 'equal':
            return '='
          default:
            return key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
        }
      })
      .join(' + ')
  }

  // 获取快捷键显示文本的辅助函数
  const getShortcutDisplay = (shortcutKey: string) => {
    const shortcut = shortcuts.find((s) => s.key === shortcutKey)
    if (shortcut && shortcut.enabled) {
      return formatShortcut(shortcut.shortcut)
    }
    return ''
  }

  return (
    <StyledModal
      title={
        <ModalTitle>
          <ModalTitleText>{t('settings.shortcuts.title')}</ModalTitleText>
          <SearchInput
            type="text"
            placeholder={t('common.search')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </ModalTitle>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={600}
      theme={theme}>
      <Content>
        {renderShortcutCategory(t('shortcuts.category.navigation'), categorizedShortcuts.navigation)}
        {renderShortcutCategory(t('shortcuts.category.editing'), categorizedShortcuts.editing)}
        {renderShortcutCategory(t('shortcuts.category.search'), categorizedShortcuts.search)}
        {renderShortcutCategory(t('shortcuts.category.system'), categorizedShortcuts.system)}
        {categorizedShortcuts.other.length > 0 &&
          renderShortcutCategory(t('shortcuts.category.other'), categorizedShortcuts.other)}

        {filteredShortcuts.length === 0 && <NoResults>{t('shortcuts.no_results')}</NoResults>}
      </Content>
    </StyledModal>
  )
}

// 创建一个显示快捷键帮助的函数
let showShortcutsHelp: (() => void) | null = null

export const ShortcutsHelpService = {
  show: () => {
    showShortcutsHelp?.()
  },
  setshowFunction: (fn: () => void) => {
    showShortcutsHelp = fn
  }
}

const ShortcutsHelpContainer: FC = () => {
  const [visible, setVisible] = useState(false)

  const show = useCallback(() => {
    setVisible(true)
  }, [])

  const hide = useCallback(() => {
    setVisible(false)
  }, [])

  // 注册显示函数
  useState(() => {
    ShortcutsHelpService.setshowFunction(show)
  })

  return <ShortcutsHelp visible={visible} onClose={hide} />
}

export default ShortcutsHelpContainer

// 样式组件
const StyledModal = styled(Modal)<{ theme: any }>`
  .ant-modal-content {
    background: ${({ theme }) => (theme === 'dark' ? 'var(--color-background)' : 'var(--color-background-soft)')};
    border: 1px solid var(--color-border);
    border-radius: 12px;
  }

  .ant-modal-header {
    background: transparent;
    border-bottom: 1px solid var(--color-border);
  }

  .ant-modal-title {
    color: var(--color-text-1);
  }

  .ant-modal-body {
    padding: 0;
  }

  .ant-modal-close {
    color: var(--color-text-2);
  }
`

const ModalTitle = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
`

const ModalTitleText = styled.div`
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-1);
`

const SearchInput = styled.input`
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-text-1);
  font-size: 14px;
  width: 200px;
  outline: none;

  &:focus {
    border-color: var(--color-primary);
  }

  &::placeholder {
    color: var(--color-text-3);
  }
`

const Content = styled.div`
  max-height: 60vh;
  overflow-y: auto;
  padding: 20px;
`

const CategorySection = styled.div`
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }
`

const CategoryTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-1);
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const ShortcutItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  margin-bottom: 4px;
  border-radius: 6px;
  background: var(--color-background);
  border: 1px solid var(--color-border);

  &:hover {
    background: var(--color-list-item-hover);
  }
`

const ShortcutName = styled.div`
  font-size: 14px;
  color: var(--color-text-1);
`

const ShortcutKeys = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  font-family: monospace;
  background: var(--color-background-mute);
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
`

const NoResults = styled.div`
  text-align: center;
  color: var(--color-text-3);
  font-size: 14px;
  padding: 40px 20px;
`
