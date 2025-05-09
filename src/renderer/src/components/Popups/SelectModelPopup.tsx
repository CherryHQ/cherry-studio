import { PushpinOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { getModelLogo, isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { classNames } from '@renderer/utils/style'
import { Avatar, Divider, Empty, Input, InputRef, Modal } from 'antd'
import { first, sortBy } from 'lodash'
import { Search } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { FixedSizeList } from 'react-window'
import styled from 'styled-components'

import { HStack } from '../Layout'
import ModelTagsWithLabel from '../ModelTagsWithLabel'

const PAGE_SIZE = 9
const ITEM_HEIGHT = 36

// 列表项类型，组名也作为列表项
type ListItemType = 'group' | 'model'

// 滚动触发来源类型
type ScrollTrigger = 'initial' | 'search' | 'keyboard' | 'none'

// 扁平化列表项接口
interface FlatListItem {
  key: string
  type: ListItemType
  icon?: React.ReactNode
  name: React.ReactNode
  tags?: React.ReactNode
  model?: Model
  isPinned?: boolean
  isSelected?: boolean
}

interface Props {
  model?: Model
}

interface PopupContainerProps extends Props {
  resolve: (value: Model | undefined) => void
}

const PopupContainer: React.FC<PopupContainerProps> = ({ model, resolve }) => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const [open, setOpen] = useState(true)
  const inputRef = useRef<InputRef>(null)
  const listRef = useRef<FixedSizeList>(null)
  const [_searchText, setSearchText] = useState('')
  const searchText = useDeferredValue(_searchText)
  const [isMouseOver, setIsMouseOver] = useState(false)
  const [pinnedModels, setPinnedModels] = useState<string[]>([])
  const [_focusedItemKey, setFocusedItemKey] = useState<string>('')
  const focusedItemKey = useDeferredValue(_focusedItemKey)
  const [_stickyGroup, setStickyGroup] = useState<FlatListItem | null>(null)
  const stickyGroup = useDeferredValue(_stickyGroup)
  const firstGroupRef = useRef<FlatListItem | null>(null)
  const scrollTriggerRef = useRef<ScrollTrigger>('initial')
  const lastScrollOffsetRef = useRef(0)

  // 当前选中的模型ID
  const currentModelId = model ? getModelUniqId(model) : ''

  // 加载置顶模型列表
  useEffect(() => {
    const loadPinnedModels = async () => {
      const setting = await db.settings.get('pinned:models')
      const savedPinnedModels = setting?.value || []

      // Filter out invalid pinned models
      const allModelIds = providers.flatMap((p) => p.models || []).map((m) => getModelUniqId(m))
      const validPinnedModels = savedPinnedModels.filter((id) => allModelIds.includes(id))

      // Update storage if there were invalid models
      if (validPinnedModels.length !== savedPinnedModels.length) {
        await db.settings.put({ id: 'pinned:models', value: validPinnedModels })
      }

      setPinnedModels(sortBy(validPinnedModels))
    }

    try {
      loadPinnedModels()
    } catch (error) {
      console.error('Failed to load pinned models', error)
      setPinnedModels([])
    }
  }, [providers])

  const togglePin = useCallback(
    async (modelId: string) => {
      const newPinnedModels = pinnedModels.includes(modelId)
        ? pinnedModels.filter((id) => id !== modelId)
        : [...pinnedModels, modelId]

      try {
        await db.settings.put({ id: 'pinned:models', value: newPinnedModels })
        setPinnedModels(sortBy(newPinnedModels))
        // Pin操作不触发滚动
        scrollTriggerRef.current = 'none'
      } catch (error) {
        console.error('Failed to update pinned models', error)
      }
    },
    [pinnedModels]
  )

  // 根据输入的文本筛选模型
  const getFilteredModels = useCallback(
    (provider) => {
      let models = provider.models.filter((m) => !isEmbeddingModel(m) && !isRerankModel(m))

      if (searchText.trim()) {
        const keywords = searchText.toLowerCase().split(/\s+/).filter(Boolean)
        models = models.filter((m) => {
          const fullName = provider.isSystem
            ? `${m.name} ${provider.name} ${t('provider.' + provider.id)}`
            : `${m.name} ${provider.name}`

          const lowerFullName = fullName.toLowerCase()
          return keywords.every((keyword) => lowerFullName.includes(keyword))
        })
      } else {
        // 如果不是搜索状态，过滤掉已固定的模型
        models = models.filter((m) => !pinnedModels.includes(getModelUniqId(m)))
      }

      return sortBy(models, ['group', 'name'])
    },
    [searchText, t, pinnedModels]
  )

  // 创建模型列表项
  const createModelItem = useCallback(
    (model: Model, provider: any, isPinned: boolean): FlatListItem => {
      const modelId = getModelUniqId(model)
      const groupName = provider.isSystem ? t(`provider.${provider.id}`) : provider.name

      return {
        key: isPinned ? `${modelId}_pinned` : modelId,
        type: 'model',
        name: (
          <ModelName>
            {model.name}
            {isPinned && <span style={{ color: 'var(--color-text-3)' }}> | {groupName}</span>}
          </ModelName>
        ),
        tags: (
          <TagsContainer>
            <ModelTagsWithLabel model={model} size={11} showLabel={false} />
          </TagsContainer>
        ),
        icon: (
          <Avatar src={getModelLogo(model.id || '')} size={24}>
            {first(model.name) || 'M'}
          </Avatar>
        ),
        model,
        isPinned,
        isSelected: modelId === currentModelId
      }
    },
    [t, currentModelId]
  )

  // 构建扁平化列表数据
  const listItems = useMemo(() => {
    const items: FlatListItem[] = []

    // 添加置顶模型分组（仅在无搜索文本时）
    if (pinnedModels.length > 0 && searchText.length === 0) {
      const pinnedItems = providers.flatMap((p) =>
        p.models.filter((m) => pinnedModels.includes(getModelUniqId(m))).map((m) => createModelItem(m, p, true))
      )

      if (pinnedItems.length > 0) {
        // 添加置顶分组标题
        items.push({
          key: 'pinned-group',
          type: 'group',
          name: t('models.pinned'),
          isSelected: false
        })

        items.push(...pinnedItems)
      }
    }

    // 添加常规模型分组
    providers.forEach((p) => {
      const filteredModels = getFilteredModels(p).filter(
        (m) => !pinnedModels.includes(getModelUniqId(m)) || searchText.length > 0
      )

      if (filteredModels.length === 0) return

      // 添加 provider 分组标题
      items.push({
        key: `provider-${p.id}`,
        type: 'group',
        name: p.isSystem ? t(`provider.${p.id}`) : p.name,
        isSelected: false
      })

      items.push(...filteredModels.map((m) => createModelItem(m, p, pinnedModels.includes(getModelUniqId(m)))))
    })

    // 移除第一个分组标题，使用 sticky group banner 替代，模拟 sticky 效果
    if (items.length > 0 && items[0].type === 'group') {
      firstGroupRef.current = items[0]
      items.shift()
    } else {
      firstGroupRef.current = null
    }
    return items
  }, [providers, getFilteredModels, pinnedModels, searchText, t, createModelItem])

  // 基于滚动位置更新sticky分组标题
  const updateStickyGroup = useCallback(
    (scrollOffset?: number) => {
      if (listItems.length === 0) {
        setStickyGroup(null)
        return
      }

      // 基于滚动位置计算当前可见的第一个项的索引
      const estimatedIndex = Math.floor((scrollOffset ?? lastScrollOffsetRef.current) / ITEM_HEIGHT)

      // 从该索引向前查找最近的分组标题
      for (let i = estimatedIndex - 1; i >= 0; i--) {
        if (i < listItems.length && listItems[i]?.type === 'group') {
          setStickyGroup(listItems[i])
          return
        }
      }

      // 找不到则使用第一个分组标题
      setStickyGroup(firstGroupRef.current ?? null)
    },
    [listItems]
  )

  // 在listItems变化时更新sticky group
  useEffect(() => {
    updateStickyGroup()
  }, [listItems, updateStickyGroup])

  // 处理列表滚动事件，更新lastScrollOffset并更新sticky分组
  const handleScroll = useCallback(
    ({ scrollOffset }) => {
      lastScrollOffsetRef.current = scrollOffset
      updateStickyGroup(scrollOffset)
    },
    [updateStickyGroup]
  )

  // 获取可选择的模型项（过滤掉分组标题）
  const modelItems = useMemo(() => {
    return listItems.filter((item) => item.type === 'model')
  }, [listItems])

  // 搜索文本变化时设置滚动来源
  useEffect(() => {
    if (searchText.trim() !== '') {
      scrollTriggerRef.current = 'search'
      setFocusedItemKey('')
    }
  }, [searchText])

  // 设置初始聚焦项以触发滚动
  useEffect(() => {
    if (scrollTriggerRef.current === 'initial' || scrollTriggerRef.current === 'search') {
      const selectedItem = modelItems.find((item) => item.isSelected)
      if (selectedItem) {
        setFocusedItemKey(selectedItem.key)
      } else if (scrollTriggerRef.current === 'initial' && modelItems.length > 0) {
        setFocusedItemKey(modelItems[0].key)
      }
      // 其余情况不设置focusedItemKey
    }
  }, [modelItems])

  // 滚动到聚焦项
  useEffect(() => {
    if (scrollTriggerRef.current === 'none' || !focusedItemKey) return

    const index = listItems.findIndex((item) => item.key === focusedItemKey)
    if (index < 0) return

    // 根据触发源决定滚动对齐方式
    const alignment = scrollTriggerRef.current === 'keyboard' ? 'auto' : 'center'
    listRef.current?.scrollToItem(index, alignment)

    // 滚动后重置触发器
    scrollTriggerRef.current = 'none'
  }, [focusedItemKey, listItems])

  const handleItemClick = useCallback(
    (item: FlatListItem) => {
      if (item.type === 'model') {
        scrollTriggerRef.current = 'none'
        resolve(item.model)
        setOpen(false)
      }
    },
    [resolve]
  )

  // 处理键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return

      if (modelItems.length === 0) {
        return
      }

      // 键盘操作时禁用鼠标 hover
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter', 'Escape'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
      }

      const getCurrentIndex = (currentKey: string) => {
        const currentIndex = modelItems.findIndex((item) => item.key === currentKey)
        return currentIndex < 0 ? 0 : currentIndex
      }

      switch (e.key) {
        case 'ArrowUp':
          scrollTriggerRef.current = 'keyboard'
          setFocusedItemKey((prev) => {
            const currentIndex = getCurrentIndex(prev)
            const nextIndex = (currentIndex - 1 + modelItems.length) % modelItems.length
            return modelItems[nextIndex].key
          })
          break
        case 'ArrowDown':
          scrollTriggerRef.current = 'keyboard'
          setFocusedItemKey((prev) => {
            const currentIndex = getCurrentIndex(prev)
            const nextIndex = (currentIndex + 1) % modelItems.length
            return modelItems[nextIndex].key
          })
          break
        case 'PageUp':
          scrollTriggerRef.current = 'keyboard'
          setFocusedItemKey((prev) => {
            const currentIndex = getCurrentIndex(prev)
            const nextIndex = Math.max(currentIndex - PAGE_SIZE, 0)
            return modelItems[nextIndex].key
          })
          break
        case 'PageDown':
          scrollTriggerRef.current = 'keyboard'
          setFocusedItemKey((prev) => {
            const currentIndex = getCurrentIndex(prev)
            const nextIndex = Math.min(currentIndex + PAGE_SIZE, modelItems.length - 1)
            return modelItems[nextIndex].key
          })
          break
        case 'Enter':
          if (focusedItemKey) {
            const selectedItem = modelItems.find((item) => item.key === focusedItemKey)
            if (selectedItem) {
              handleItemClick(selectedItem)
            }
          }
          break
        case 'Escape':
          e.preventDefault()
          scrollTriggerRef.current = 'none'
          setOpen(false)
          resolve(undefined)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedItemKey, modelItems, handleItemClick, open, resolve])

  const onCancel = useCallback(() => {
    scrollTriggerRef.current = 'none'
    setOpen(false)
  }, [])

  const onClose = useCallback(async () => {
    scrollTriggerRef.current = 'none'
    resolve(undefined)
    SelectModelPopup.hide()
  }, [resolve])

  useEffect(() => {
    if (!open) return
    setTimeout(() => inputRef.current?.focus(), 0)
    scrollTriggerRef.current = 'initial'
    lastScrollOffsetRef.current = 0
  }, [open])

  const RowData = useMemo(
    (): VirtualizedRowData => ({
      listItems,
      focusedItemKey,
      setFocusedItemKey,
      stickyGroup,
      handleItemClick,
      togglePin
    }),
    [stickyGroup, focusedItemKey, handleItemClick, listItems, togglePin]
  )

  const listHeight = useMemo(() => {
    return Math.min(PAGE_SIZE, listItems.length) * ITEM_HEIGHT
  }, [listItems.length])

  return (
    <Modal
      centered
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      width={600}
      transitionName="animation-move-down"
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
      {/* 搜索框 */}
      <HStack style={{ padding: '0 12px', marginTop: 5 }}>
        <Input
          prefix={
            <SearchIcon>
              <Search size={15} />
            </SearchIcon>
          }
          ref={inputRef}
          placeholder={t('models.search')}
          value={_searchText} // 使用 _searchText，需要实时更新
          onChange={(e) => setSearchText(e.target.value)}
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
      <Divider style={{ margin: 0, marginTop: 4, borderBlockStartWidth: 0.5 }} />

      {listItems.length > 0 ? (
        <ListContainer onMouseMove={() => setIsMouseOver(true)}>
          {/* Sticky Group Banner，它会替换第一个分组名称 */}
          <StickyGroupBanner>{stickyGroup?.name}</StickyGroupBanner>
          <FixedSizeList
            ref={listRef}
            height={listHeight}
            width="100%"
            itemCount={listItems.length}
            itemSize={ITEM_HEIGHT}
            itemData={RowData}
            itemKey={(index, data) => data.listItems[index].key}
            overscanCount={4}
            onScroll={handleScroll}
            style={{ pointerEvents: isMouseOver ? 'auto' : 'none' }}>
            {VirtualizedRow}
          </FixedSizeList>
        </ListContainer>
      ) : (
        <EmptyState>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </EmptyState>
      )}
    </Modal>
  )
}

interface VirtualizedRowData {
  listItems: FlatListItem[]
  focusedItemKey: string
  setFocusedItemKey: (key: string) => void
  stickyGroup: FlatListItem | null
  handleItemClick: (item: FlatListItem) => void
  togglePin: (modelId: string) => void
}

/**
 * 虚拟化列表行组件，用于避免重新渲染
 */
const VirtualizedRow = React.memo(
  ({ data, index, style }: { data: VirtualizedRowData; index: number; style: React.CSSProperties }) => {
    const { listItems, focusedItemKey, setFocusedItemKey, handleItemClick, togglePin, stickyGroup } = data

    const item = listItems[index]

    if (!item) {
      return <div style={style} />
    }

    return (
      <div style={style}>
        {item.type === 'group' ? (
          <GroupItem $isSticky={item.key === stickyGroup?.key}>{item.name}</GroupItem>
        ) : (
          <ModelItem
            className={classNames({
              focused: item.key === focusedItemKey,
              selected: item.isSelected
            })}
            onClick={() => handleItemClick(item)}
            onMouseEnter={() => setFocusedItemKey(item.key)}>
            <ModelItemLeft>
              {item.icon}
              {item.name}
              {item.tags}
            </ModelItemLeft>
            <PinIconWrapper
              onClick={(e) => {
                e.stopPropagation()
                if (item.model) {
                  togglePin(getModelUniqId(item.model))
                }
              }}
              data-pinned={item.isPinned}
              $isPinned={item.isPinned}>
              <PushpinOutlined />
            </PinIconWrapper>
          </ModelItem>
        )}
      </div>
    )
  }
)

VirtualizedRow.displayName = 'VirtualizedRow'

const ListContainer = styled.div`
  position: relative;
  overflow: hidden;
`

const GroupItem = styled.div<{ $isSticky?: boolean }>`
  display: flex;
  align-items: center;
  position: relative;
  font-size: 12px;
  font-weight: 500;
  height: ${ITEM_HEIGHT}px;
  padding: 5px 10px 5px 18px;
  color: var(--color-text-3);
  z-index: 1;

  visibility: ${(props) => (props.$isSticky ? 'hidden' : 'visible')};
`

const StickyGroupBanner = styled(GroupItem)`
  position: sticky;
  background: var(--modal-background);
`

const ModelItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  font-size: 14px;
  padding: 0 8px;
  margin: 1px 8px;
  height: ${ITEM_HEIGHT - 2}px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.1s ease;

  &.focused {
    background-color: var(--color-background-mute);
  }

  &.selected {
    &::before {
      content: '';
      display: block;
      position: absolute;
      left: -1px;
      top: 13%;
      width: 3px;
      height: 74%;
      background: var(--color-primary-soft);
      border-radius: 8px;
    }
  }

  .pin-icon {
    opacity: 0;
  }

  &:hover .pin-icon {
    opacity: 0.3;
  }
`

const ModelItemLeft = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  overflow: hidden;
  padding-right: 26px;

  .anticon {
    min-width: auto;
    flex-shrink: 0;
  }
`

const ModelName = styled.span`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  margin: 0 8px;
  min-width: 0;
`

const TagsContainer = styled.div`
  display: flex;
  justify-content: flex-end;
  min-width: 80px;
  max-width: 180px;
  overflow: hidden;
  flex-shrink: 0;
`

const EmptyState = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
`

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

const PinIconWrapper = styled.div.attrs({ className: 'pin-icon' })<{ $isPinned?: boolean }>`
  margin-left: auto;
  padding: 0 10px;
  opacity: ${(props) => (props.$isPinned ? 1 : 'inherit')};
  transition: opacity 0.2s;
  position: absolute;
  right: 0;
  color: ${(props) => (props.$isPinned ? 'var(--color-primary)' : 'inherit')};
  transform: ${(props) => (props.$isPinned ? 'rotate(-45deg)' : 'none')};

  &:hover {
    opacity: 1 !important;
    color: ${(props) => (props.$isPinned ? 'var(--color-primary)' : 'inherit')};
  }
`

export default class SelectModelPopup {
  static hide() {
    TopView.hide('SelectModelPopup')
  }

  static show(params: Props) {
    return new Promise<Model | undefined>((resolve) => {
      TopView.show(<PopupContainer {...params} resolve={resolve} />, 'SelectModelPopup')
    })
  }
}
