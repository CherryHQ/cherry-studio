import { PushpinOutlined } from '@ant-design/icons'
import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import { TopView } from '@renderer/components/TopView'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { getModelLogo, isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { usePinnedModels } from '@renderer/hooks/usePinnedModels'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model, Provider } from '@renderer/types'
import { classNames, filterModelsByKeywords, getFancyProviderName } from '@renderer/utils'
import { Avatar, Divider, Empty, Modal } from 'antd'
import { first, sortBy } from 'lodash'
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

import SelectModelSearchBar from './searchbar'
import { FlatListItem } from './types'

const PAGE_SIZE = 11
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
  const listRef = useRef<DynamicVirtualListRef>(null)
  const [_searchText, setSearchText] = useState('')
  const searchText = useDeferredValue(_searchText)

  // 当前选中的模型ID
  const currentModelId = model ? getModelUniqId(model) : ''

  // 管理滚动和焦点状态
  const [focusedItemKey, _setFocusedItemKey] = useState('')
  const [isMouseOver, setIsMouseOver] = useState(false)
  const preventScrollToIndex = useRef(false)

  const setFocusedItemKey = useCallback((key: string) => {
    startTransition(() => {
      _setFocusedItemKey(key)
    })
  }, [])

  // 根据输入的文本筛选模型
  const getFilteredModels = useCallback(
    (provider: Provider) => {
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
    (model: Model, provider: Provider, isPinned: boolean): FlatListItem => {
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

  // 构建扁平化列表数据，并派生出可选择的模型项
  const { listItems, modelItems } = useMemo(() => {
    const items: FlatListItem[] = []
    const pinnedModelIds = new Set(pinnedModels)
    const finalModelFilter = modelFilter || (() => true)

    // 添加置顶模型分组（仅在无搜索文本时）
    if (searchText.length === 0 && pinnedModelIds.size > 0) {
      const pinnedItems = providers.flatMap((p) =>
        p.models
          .filter((m) => pinnedModelIds.has(getModelUniqId(m)))
          .filter(finalModelFilter)
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
        .filter((m) => searchText.length > 0 || !pinnedModelIds.has(getModelUniqId(m)))
        .filter(finalModelFilter)

      if (filteredModels.length === 0) return

      // 添加 provider 分组标题
      items.push({
        key: `provider-${p.id}`,
        type: 'group',
        name: getFancyProviderName(p),
        isSelected: false
      })

      items.push(...filteredModels.map((m) => createModelItem(m, p, pinnedModelIds.has(getModelUniqId(m)))))
    })

    // 获取可选择的模型项（过滤掉分组标题）
    const modelItems = items.filter((item) => item.type === 'model') as FlatListItem[]
    return { listItems: items, modelItems }
  }, [searchText.length, pinnedModels, providers, modelFilter, createModelItem, t, getFilteredModels])

  const listHeight = useMemo(() => {
    return Math.min(PAGE_SIZE, listItems.length) * ITEM_HEIGHT
  }, [listItems.length])

  // 处理程序化滚动（加载、搜索开始、搜索清空）
  useLayoutEffect(() => {
    if (loading) return

    if (preventScrollToIndex.current) {
      preventScrollToIndex.current = false
      return
    }

    let targetItemKey: string | undefined

    // 启动搜索时，滚动到第一个 item
    if (searchText) {
      targetItemKey = modelItems[0]?.key
    }
    // 初始加载或清空搜索时，滚动到 selected item
    else {
      targetItemKey = modelItems.find((item) => item.isSelected)?.key
    }

    if (targetItemKey) {
      setFocusedItemKey(targetItemKey)
      const index = listItems.findIndex((item) => item.key === targetItemKey)
      if (index >= 0) {
        // FIXME: 手动计算偏移量，给 scroller 增加了 scrollPaddingStart 之后，
        // scrollToIndex 不能准确滚动到 item 中心，但是又需要 padding 来改善体验。
        const targetScrollTop = index * ITEM_HEIGHT - listHeight / 2
        listRef.current?.scrollToOffset(targetScrollTop, {
          align: 'start',
          behavior: 'auto'
        })
      }
    }
  }, [searchText, listItems, modelItems, loading, setFocusedItemKey, listHeight])

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
      const modelCount = modelItems.length

      if (!open || modelCount === 0 || e.isComposing) return

      // 键盘操作时禁用鼠标 hover
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter', 'Escape'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
      }

      // 当前聚焦的模型 index
      const currentIndex = modelItems.findIndex((item) => item.key === focusedItemKey)

      let nextIndex = -1

      switch (e.key) {
        case 'ArrowUp': {
          nextIndex = (currentIndex < 0 ? 0 : currentIndex - 1 + modelCount) % modelCount
          break
        }
        case 'ArrowDown': {
          nextIndex = (currentIndex < 0 ? 0 : currentIndex + 1) % modelCount
          break
        }
        case 'PageUp': {
          nextIndex = Math.max(0, (currentIndex < 0 ? 0 : currentIndex) - PAGE_SIZE)
          break
        }
        case 'PageDown': {
          nextIndex = Math.min(modelCount - 1, (currentIndex < 0 ? 0 : currentIndex) + PAGE_SIZE)
          break
        }
        case 'Enter':
          if (currentIndex >= 0) {
            const selectedItem = modelItems[currentIndex]
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

      // 没有键盘导航，直接返回
      if (nextIndex < 0) return

      const nextKey = modelItems[nextIndex]?.key || ''
      if (nextKey) {
        setFocusedItemKey(nextKey)
        const index = listItems.findIndex((item) => item.key === nextKey)
        if (index >= 0) {
          listRef.current?.scrollToIndex(index, { align: 'auto' })
        }
      }
    },
    [modelItems, open, focusedItemKey, resolve, handleItemClick, setFocusedItemKey, listItems]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const onCancel = useCallback(() => {
    setOpen(false)
  }, [])

  const onAfterClose = useCallback(async () => {
    resolve(undefined)
    SelectModelPopup.hide()
  }, [resolve])

  const togglePin = useCallback(
    async (modelId: string) => {
      await togglePinnedModel(modelId)
      preventScrollToIndex.current = true
    },
    [togglePinnedModel]
  )

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
      <SelectModelSearchBar onSearch={setSearchText} />
      <Divider style={{ margin: 0, marginTop: 4, borderBlockStartWidth: 0.5 }} />

      {listItems.length > 0 ? (
        <ListContainer onMouseMove={() => !isMouseOver && setIsMouseOver(true)}>
          <DynamicVirtualList
            ref={listRef}
            list={listItems}
            size={listHeight}
            getItemKey={getItemKey}
            estimateSize={estimateSize}
            isSticky={isSticky}
            scrollPaddingStart={ITEM_HEIGHT} // 留出 sticky header 高度
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
