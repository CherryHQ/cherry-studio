import { FreeTrialModelTag } from '@renderer/components/FreeTrialModelTag'
import { HStack } from '@renderer/components/Layout'
import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import { TopView } from '@renderer/components/TopView'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { getModelLogoById } from '@renderer/config/models'
import { useApiModels } from '@renderer/hooks/agents/useModels'
import { getModelUniqId } from '@renderer/services/ModelService'
import { getProviderNameById } from '@renderer/services/ProviderService'
import { AdaptedApiModel, ApiModel, ApiModelsFilter, Model, ModelType, objectEntries } from '@renderer/types'
import { classNames, filterModelsByKeywords } from '@renderer/utils'
import { apiModelAdapter, getModelTags } from '@renderer/utils/model'
import { Avatar, Divider, Empty, Modal } from 'antd'
import { first, groupBy, sortBy } from 'lodash'
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
import styled from 'styled-components'

import { useModelTagFilter } from './filters'
import SelectModelSearchBar from './searchbar'
import TagFilterSection from './TagFilterSection'
import { FlatListApiItem, FlatListApiModel } from './types'

const PAGE_SIZE = 12
const ITEM_HEIGHT = 36

interface PopupParams {
  model?: ApiModel
  /** Api models filter */
  apiFilter?: ApiModelsFilter
  /** model filter */
  modelFilter?: (model: Model) => boolean
  /** Show tag filter section */
  showTagFilter?: boolean
}

interface Props extends PopupParams {
  resolve: (value: ApiModel | undefined) => void
}

export type FilterType = Exclude<ModelType, 'text'> | 'free'

// const logger = loggerService.withContext('SelectModelPopup')

const PopupContainer: React.FC<Props> = ({ model, apiFilter, modelFilter, showTagFilter = true, resolve }) => {
  const [open, setOpen] = useState(true)
  const listRef = useRef<DynamicVirtualListRef>(null)
  const [_searchText, setSearchText] = useState('')
  const searchText = useDeferredValue(_searchText)
  const { models, isLoading } = useApiModels(apiFilter)
  const adaptedModels = models.map((model) => apiModelAdapter(model))

  // 当前选中的模型ID
  const currentModelId = model ? model.id : ''

  // 管理滚动和焦点状态
  const [focusedItemKey, _setFocusedItemKey] = useState('')
  const [isMouseOver, setIsMouseOver] = useState(false)
  const preventScrollToIndex = useRef(false)

  const setFocusedItemKey = useCallback((key: string) => {
    startTransition(() => {
      _setFocusedItemKey(key)
    })
  }, [])

  const { tagSelection, selectedTags, tagFilter, toggleTag } = useModelTagFilter()

  // 计算要显示的可用标签列表
  const availableTags = useMemo(() => {
    return objectEntries(getModelTags(adaptedModels))
      .filter(([, state]) => state)
      .map(([tag]) => tag)
  }, [adaptedModels])

  // 根据输入的文本筛选模型
  const searchFilter = useCallback(
    (models: AdaptedApiModel[]) => {
      if (searchText.trim()) {
        models = filterModelsByKeywords(searchText, models)
      }

      return sortBy(models, ['group', 'name'])
    },
    [searchText]
  )

  // 创建模型列表项
  const createModelItem = useCallback(
    (model: AdaptedApiModel): FlatListApiModel => {
      const modelId = getModelUniqId(model)
      const isCherryAi = model.provider === 'cherryai'

      return {
        key: modelId,
        type: 'model',
        name: (
          <ModelName>
            <HStack alignItems="center">{model.name}</HStack>
            {isCherryAi && <FreeTrialModelTag model={model} showLabel={false} />}
          </ModelName>
        ),
        tags: (
          <TagsContainer>
            <ModelTagsWithLabel model={model} size={11} showLabel={true} />
          </TagsContainer>
        ),
        icon: (
          <Avatar src={getModelLogoById(model.id || '')} size={24}>
            {first(model.name) || 'M'}
          </Avatar>
        ),
        model,
        isSelected: modelId === currentModelId
      }
    },
    [currentModelId]
  )

  // 构建扁平化列表数据，并派生出可选择的模型项
  const { listItems, modelItems } = useMemo(() => {
    const items: FlatListApiItem[] = []
    const finalModelFilter = (model: AdaptedApiModel) => {
      const _tagFilter = !showTagFilter || tagFilter(model)
      const _modelFilter = modelFilter === undefined || modelFilter(model)
      return _tagFilter && _modelFilter
    }

    // 筛选模型
    const filteredModels = searchFilter(adaptedModels).filter(finalModelFilter)

    // 按 provider 分组
    const groups = groupBy(filteredModels, (model) => model.provider) as Record<string, AdaptedApiModel[]>

    objectEntries(groups).forEach(([key, models]) => {
      items.push({
        key: key ?? 'Unknown',
        type: 'group',
        name: getProviderNameById(key ?? 'Unknown'),
        isSelected: false
      })
      items.push(...models.map((m) => createModelItem(m)))
    })

    // 获取可选择的模型项（过滤掉分组标题）
    const modelItems = items.filter((item) => item.type === 'model')
    return { listItems: items, modelItems }
  }, [searchFilter, adaptedModels, showTagFilter, tagFilter, createModelItem, modelFilter])

  const listHeight = useMemo(() => {
    return Math.min(PAGE_SIZE, listItems.length) * ITEM_HEIGHT
  }, [listItems.length])

  // 处理程序化滚动（加载、搜索开始、搜索清空、tag 筛选）
  useLayoutEffect(() => {
    if (isLoading) return

    if (preventScrollToIndex.current) {
      preventScrollToIndex.current = false
      return
    }

    let targetItemKey: string | undefined

    // 启动搜索或 tag 筛选时，滚动到第一个 item
    if (searchText || selectedTags.length > 0) {
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
  }, [searchText, listItems, modelItems, setFocusedItemKey, listHeight, selectedTags.length, isLoading])

  const handleItemClick = useCallback(
    (item: FlatListApiItem) => {
      if (item.type === 'model') {
        resolve(item.model.origin)
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
          e.stopPropagation()
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
    SelectApiModelPopup.hide()
  }, [resolve])

  const getItemKey = useCallback((index: number) => listItems[index].key, [listItems])
  const estimateSize = useCallback(() => ITEM_HEIGHT, [])
  const isSticky = useCallback((index: number) => listItems[index].type === 'group', [listItems])

  const rowRenderer = useCallback(
    (item: FlatListApiItem) => {
      const isFocused = item.key === focusedItemKey
      if (item.type === 'group') {
        return (
          <GroupItem>
            {item.name}
            {item.actions}
          </GroupItem>
        )
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
        </ModelItem>
      )
    },
    [focusedItemKey, handleItemClick, setFocusedItemKey]
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
      {showTagFilter && (
        <>
          <TagFilterSection availableTags={availableTags} tagSelection={tagSelection} onToggleTag={toggleTag} />
          <Divider style={{ margin: 0, borderBlockStartWidth: 0.5 }} />
        </>
      )}

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
  gap: 8px;
  position: relative;
  line-height: 1;
  font-size: 12px;
  font-weight: normal;
  height: ${ITEM_HEIGHT}px;
  padding: 5px 18px;
  color: var(--color-text-3);
  z-index: 1;
  background: var(--modal-background);

  .action-icon {
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s;

    &:hover {
      opacity: 1 !important;
    }
  }
  &:hover .action-icon {
    opacity: 0.3;
  }
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

const ModelName = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  margin: 0 8px;
  min-width: 0;
  gap: 5px;
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

const TopViewKey = 'SelectModelPopup'

export class SelectApiModelPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }

  static show(params: PopupParams) {
    return new Promise<ApiModel | undefined>((resolve) => {
      TopView.show(<PopupContainer {...params} resolve={(v) => resolve(v)} />, TopViewKey)
    })
  }
}
