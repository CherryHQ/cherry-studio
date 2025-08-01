import { PushpinOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import { TopView } from '@renderer/components/TopView'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { getModelLogo, isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { usePinnedModels } from '@renderer/hooks/usePinnedModels'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { classNames, filterModelsByKeywords, getFancyProviderName } from '@renderer/utils'
import { Avatar, Divider, Empty, Input, InputRef, Modal } from 'antd'
import { first, sortBy } from 'lodash'
import { Search } from 'lucide-react'
import React, {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { useScrollState } from './hook'
import { FlatListItem } from './types'

const PAGE_SIZE = 10
const ITEM_HEIGHT = 36

interface PopupParams {
  model?: Model
  modelFilter?: (model: Model) => boolean
}

interface Props extends PopupParams {
  resolve: (value: Model | undefined) => void
  modelFilter?: (model: Model) => boolean
}

const PopupContainer: React.FC<Props> = ({ model, resolve, modelFilter }) => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { pinnedModels, togglePinnedModel, loading } = usePinnedModels()
  const [open, setOpen] = useState(true)
  const inputRef = useRef<InputRef>(null)
  const listRef = useRef<DynamicVirtualListRef>(null)
  const [_searchText, setSearchText] = useState('')
  const searchText = useDeferredValue(_searchText)

  // 当前选中的模型ID
  const currentModelId = model ? getModelUniqId(model) : ''

  // 管理滚动和焦点状态
  const {
    focusedItemKey,
    scrollTrigger,
    isMouseOver,
    setFocusedItemKey: _setFocusedItemKey,
    setScrollTrigger,
    setIsMouseOver,
    focusNextItem,
    focusPage,
    searchChanged,
    focusOnListChange
  } = useScrollState()

  const setFocusedItemKey = useCallback(
    (key: string) => {
      startTransition(() => _setFocusedItemKey(key))
    },
    [_setFocusedItemKey]
  )

  // 根据输入的文本筛选模型
  const getFilteredModels = useCallback(
    (provider) => {
      let models = provider.models.filter((m) => !isEmbeddingModel(m) && !isRerankModel(m))

      if (searchText.trim()) {
        models = filterModelsByKeywords(searchText, models, provider)
      }

      return sortBy(models, ['group', 'name'])
    },
    [searchText]
  )

  // 创建模型列表项
  const createModelItem = useCallback(
    (model: Model, provider: any, isPinned: boolean): FlatListItem => {
      const modelId = getModelUniqId(model)
      const groupName = getFancyProviderName(provider)

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
            <ModelTagsWithLabel model={model} size={11} showLabel={false} showTooltip={false} />
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
    [currentModelId]
  )

  // 构建扁平化列表数据
  const listItems = useMemo(() => {
    const items: FlatListItem[] = []

    // 添加置顶模型分组（仅在无搜索文本时）
    if (searchText.length === 0 && pinnedModels.length > 0) {
      const pinnedItems = providers.flatMap((p) =>
        p.models
          .filter((m) => pinnedModels.includes(getModelUniqId(m)))
          .filter(modelFilter ? modelFilter : () => true)
          .map((m) => createModelItem(m, p, true))
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
      const filteredModels = getFilteredModels(p)
        .filter((m) => searchText.length > 0 || !pinnedModels.includes(getModelUniqId(m)))
        .filter(modelFilter ? modelFilter : () => true)

      if (filteredModels.length === 0) return

      // 添加 provider 分组标题
      items.push({
        key: `provider-${p.id}`,
        type: 'group',
        name: getFancyProviderName(p),
        isSelected: false
      })

      items.push(...filteredModels.map((m) => createModelItem(m, p, pinnedModels.includes(getModelUniqId(m)))))
    })

    return items
  }, [searchText.length, pinnedModels, providers, modelFilter, createModelItem, t, getFilteredModels])

  // 获取可选择的模型项（过滤掉分组标题）
  const modelItems = useMemo(() => {
    return listItems.filter((item) => item.type === 'model')
  }, [listItems])

  // 当搜索文本变化时更新滚动触发器
  useEffect(() => {
    searchChanged(searchText)
  }, [searchText, searchChanged])

  // 列表项更新时，更新焦点
  useEffect(() => {
    if (!loading) focusOnListChange(modelItems)
  }, [modelItems, focusOnListChange, loading])

  // 滚动到聚焦项
  useLayoutEffect(() => {
    if (scrollTrigger === 'none' || !focusedItemKey) return

    const index = listItems.findIndex((item) => item.key === focusedItemKey)
    if (index < 0) return

    // 根据触发源决定滚动对齐方式
    const alignment = scrollTrigger === 'keyboard' ? 'auto' : 'center'
    listRef.current?.scrollToIndex(index, { align: alignment })

    // 滚动后重置触发器
    setScrollTrigger('none')
  }, [focusedItemKey, scrollTrigger, listItems, setScrollTrigger])

  const handleItemClick = useCallback(
    (item: FlatListItem) => {
      if (item.type === 'model') {
        resolve(item.model)
        setOpen(false)
      }
    },
    [resolve]
  )

  // 处理键盘导航
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open || modelItems.length === 0 || e.isComposing) return

      // 键盘操作时禁用鼠标 hover
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter', 'Escape'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
      }

      const currentIndex = modelItems.findIndex((item) => item.key === focusedItemKey)
      const normalizedIndex = currentIndex < 0 ? 0 : currentIndex

      switch (e.key) {
        case 'ArrowUp':
          focusNextItem(modelItems, -1)
          break
        case 'ArrowDown':
          focusNextItem(modelItems, 1)
          break
        case 'PageUp':
          focusPage(modelItems, normalizedIndex, -PAGE_SIZE)
          break
        case 'PageDown':
          focusPage(modelItems, normalizedIndex, PAGE_SIZE)
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
          setOpen(false)
          resolve(undefined)
          break
      }
    },
    [focusedItemKey, modelItems, handleItemClick, open, resolve, setIsMouseOver, focusNextItem, focusPage]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const onCancel = useCallback(() => {
    setOpen(false)
  }, [])

  const onAfterClose = useCallback(async () => {
    setScrollTrigger('initial')
    resolve(undefined)
    SelectModelPopup.hide()
  }, [resolve, setScrollTrigger])

  // 初始化焦点和滚动位置
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  const togglePin = useCallback(
    async (modelId: string) => {
      await togglePinnedModel(modelId)
    },
    [togglePinnedModel]
  )

  const listHeight = useMemo(() => {
    return Math.min(PAGE_SIZE, listItems.length) * ITEM_HEIGHT
  }, [listItems.length])

  const getItemKey = useCallback((index: number) => listItems[index].key, [listItems])
  const estimateSize = useCallback(() => ITEM_HEIGHT, [])
  const isSticky = useCallback((index: number) => listItems[index].type === 'group', [listItems])

  const rowRenderer = useCallback(
    (item: FlatListItem) => {
      const isFocused = item.key === focusedItemKey
      if (item.type === 'group') {
        return <GroupItem>{item.name}</GroupItem>
      }
      return (
        <ModelItem
          className={classNames({
            focused: isFocused,
            selected: item.isSelected
          })}
          onClick={() => handleItemClick(item)}
          onMouseOver={() => !isFocused && setFocusedItemKey(item.key)}>
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
      )
    },
    [focusedItemKey, handleItemClick, setFocusedItemKey, togglePin]
  )

  return (
    <Modal
      centered
      open={open}
      onCancel={onCancel}
      afterClose={onAfterClose}
      width={600}
      transitionName="animation-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: 16
        },
        body: {
          maxHeight: 'inherit',
          padding: 0
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
        <ListContainer onMouseMove={() => !isMouseOver && startTransition(() => setIsMouseOver(true))}>
          <DynamicVirtualList
            ref={listRef}
            list={listItems}
            size={listHeight}
            getItemKey={getItemKey}
            estimateSize={estimateSize}
            isSticky={isSticky}
            overscan={5}
            scrollerStyle={{ pointerEvents: isMouseOver ? 'auto' : 'none' }}>
            {rowRenderer}
          </DynamicVirtualList>
        </ListContainer>
      ) : (
        <EmptyState>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </EmptyState>
      )}
    </Modal>
  )
}

const ListContainer = styled.div`
  position: relative;
  overflow: hidden;
`

const GroupItem = styled.div`
  display: flex;
  align-items: center;
  position: relative;
  font-size: 12px;
  font-weight: 500;
  height: ${ITEM_HEIGHT}px;
  padding: 5px 10px 5px 18px;
  color: var(--color-text-3);
  z-index: 1;
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

const TopViewKey = 'SelectModelPopup'

export class SelectModelPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }

  static show(params: PopupParams) {
    return new Promise<Model | undefined>((resolve) => {
      TopView.show(<PopupContainer {...params} resolve={(v) => resolve(v)} />, TopViewKey)
    })
  }
}
