import { SearchOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { Assistant } from '@renderer/types'
import { Divider, Empty, Input, InputRef, Menu, Modal, Tooltip } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AssistantAvatar from '../Avatar/AssistantAvatar'
import { HStack } from '../Layout'
import Scrollbar from '../Scrollbar'

interface Props {
  assistantId?: string
}

interface PopupContainerProps extends Props {
  resolve: (value: Assistant | undefined) => void
}

const PopupContainer: React.FC<PopupContainerProps> = ({ assistantId, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<InputRef>(null)
  const { assistants } = useAssistants()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [keyboardSelectedId, setKeyboardSelectedId] = useState<string>('')
  const menuItemRefs = useRef<Record<string, HTMLElement | null>>({})

  const setMenuItemRef = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) {
        menuItemRefs.current[key] = el
      }
    },
    []
  )

  // 根据输入的文本筛选助手
  const getFilteredAssistants = useCallback(() => {
    if (!searchText.trim()) {
      return assistants
    }

    const keywords = searchText.toLowerCase().split(/\s+/).filter(Boolean)
    return assistants.filter((assistant) => {
      const fullName = `${assistant.name} ${assistant.description || ''}`
      const lowerFullName = fullName.toLowerCase()
      return keywords.every((keyword) => lowerFullName.includes(keyword))
    })
  }, [searchText, assistants])

  const filteredAssistants = getFilteredAssistants()
  const items = filteredAssistants.map((assistant) => ({
    key: assistant.id,
    label: (
      <AssistantItem>
        <AssistantNameRow>
          <AssistantTitle>{assistant.name}</AssistantTitle>
          {assistant.description && (
            <Tooltip title={assistant.description}>
              <AssistantDescription>{assistant.description}</AssistantDescription>
            </Tooltip>
          )}
        </AssistantNameRow>
      </AssistantItem>
    ),
    icon: <AssistantAvatar assistant={assistant} size={24} />,
    onClick: () => {
      resolve(assistant)
      setOpen(false)
    }
  }))

  // 处理菜单项，为每个项添加ref
  const processedItems = items.map((item) => ({
    ...item,
    label: <div ref={setMenuItemRef(item.key as string)}>{item.label}</div>
  }))

  const onCancel = () => {
    setKeyboardSelectedId('')
    setOpen(false)
  }

  const onClose = async () => {
    setKeyboardSelectedId('')
    resolve(undefined)
    SelectAssistantPopup.hide()
  }

  useEffect(() => {
    open && setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (open && assistantId) {
      setTimeout(() => {
        if (menuItemRefs.current[assistantId]) {
          menuItemRefs.current[assistantId]?.scrollIntoView({ block: 'center', behavior: 'auto' })
        }
      }, 100) // 小延迟确保菜单已渲染
    }
  }, [open, assistantId])

  // 获取所有可见的助手项
  const getVisibleAssistantItems = useCallback(() => {
    return filteredAssistants.map((assistant) => ({
      key: assistant.id,
      assistant
    }))
  }, [filteredAssistants])

  // 处理键盘导航
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const items = getVisibleAssistantItems()
      if (items.length === 0) return

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const currentIndex = items.findIndex((item) => item.key === keyboardSelectedId)
        let nextIndex

        if (currentIndex === -1) {
          nextIndex = e.key === 'ArrowDown' ? 0 : items.length - 1
        } else {
          nextIndex =
            e.key === 'ArrowDown' ? (currentIndex + 1) % items.length : (currentIndex - 1 + items.length) % items.length
        }

        const nextItem = items[nextIndex]
        setKeyboardSelectedId(nextItem.key)
      } else if (e.key === 'Enter') {
        e.preventDefault() // 阻止回车的默认行为
        if (keyboardSelectedId) {
          const selectedItem = items.find((item) => item.key === keyboardSelectedId)
          if (selectedItem) {
            resolve(selectedItem.assistant)
            setOpen(false)
          }
        }
      }
    },
    [keyboardSelectedId, getVisibleAssistantItems, resolve, setOpen]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // 搜索文本改变时重置键盘选中状态
  useEffect(() => {
    setKeyboardSelectedId('')
  }, [searchText])

  const selectedKeys = keyboardSelectedId ? [keyboardSelectedId] : assistantId ? [assistantId] : []

  return (
    <Modal
      centered
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="ant-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: 20,
          border: '1px solid var(--color-border)'
        }
      }}
      closeIcon={null}
      footer={null}>
      <HStack style={{ padding: '0 12px', marginTop: 5 }}>
        <Input
          prefix={
            <SearchIcon>
              <SearchOutlined />
            </SearchIcon>
          }
          ref={inputRef}
          placeholder={t('assistants.search')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          autoFocus
          style={{ paddingLeft: 0 }}
          variant="borderless"
          size="middle"
          onKeyDown={(e) => {
            // 防止上下键移动光标
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
            }
          }}
        />
      </HStack>
      <Divider style={{ margin: 0, borderBlockStartWidth: 0.5 }} />
      <Scrollbar style={{ height: '50vh' }} ref={scrollContainerRef}>
        <Container>
          {processedItems.length > 0 ? (
            <StyledMenu
              items={processedItems}
              selectedKeys={selectedKeys as string[]}
              mode="inline"
              inlineIndent={6}
              onSelect={({ key }) => {
                setKeyboardSelectedId(key as string)
              }}
            />
          ) : (
            <EmptyState>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </EmptyState>
          )}
        </Container>
      </Scrollbar>
    </Modal>
  )
}

const Container = styled.div`
  margin-top: 10px;
`

const StyledMenu = styled(Menu)`
  background-color: transparent;
  padding: 5px;
  margin-top: -10px;
  max-height: calc(60vh - 50px);

  .ant-menu-item {
    height: 36px;
    line-height: 36px;

    &.ant-menu-item-selected {
      background-color: var(--color-background-mute) !important;
      color: var(--color-text-primary) !important;
    }
  }
`

const AssistantItem = styled.div`
  display: flex;
  align-items: center;
  font-size: 14px;
  position: relative;
  width: 100%;
`

const AssistantNameRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: 100%;
  overflow: hidden;
`

const AssistantTitle = styled.span`
  font-weight: 500;
  white-space: nowrap;
`

const AssistantDescription = styled.span`
  font-size: 12px;
  font-style: italic;
  color: var(--color-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const EmptyState = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
`

const SearchIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background-soft);
  margin-right: 2px;
`

export default class SelectAssistantPopup {
  static hide() {
    TopView.hide('SelectAssistantPopup')
  }
  static show(params: Props) {
    return new Promise<Assistant | undefined>((resolve) => {
      TopView.show(<PopupContainer {...params} resolve={resolve} />, 'SelectAssistantPopup')
    })
  }
}
