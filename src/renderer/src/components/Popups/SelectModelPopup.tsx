import VirtualList, { ListRef } from '@alephpiece/rc-virtual-list'
import { PushpinOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { getModelLogo, isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { Avatar, Divider, Empty, Input, InputRef, Modal } from 'antd'
import { first, sortBy } from 'lodash'
import { Search } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

import { HStack } from '../Layout'
import ModelTagsWithLabel from '../ModelTagsWithLabel'

const PAGE_SIZE = 9
const ITEM_HEIGHT = 36

// 列表项类型，组名也作为列表项
type ListItemType = 'group' | 'model'

// 扁平化列表项接口
interface FlatListItem {
  key: string
  type: ListItemType
  icon?: React.ReactNode
  name: React.ReactNode
  tags?: React.ReactNode
  model?: Model
  isPinned?: boolean
}

interface Props {
  model?: Model
}

interface PopupContainerProps extends Props {
  resolve: (value: Model | undefined) => void
}

const PopupContainer: React.FC<PopupContainerProps> = ({ model, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [_searchText, setSearchText] = useState('')
  const searchText = useDeferredValue(_searchText)
  const inputRef = useRef<InputRef>(null)
  const { providers } = useProviders()
  const [pinnedModels, setPinnedModels] = useState<string[]>([])
  const [selectedItemKey, setSelectedItemKey] = useState<string>('')
  const [focusedItemKey, setFocusedItemKey] = useState<string>('')
  const listRef = useRef<ListRef>(null)
  const hasAutoSelected = useRef(false)
  const hasAutoScrolled = useRef(false)

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

      setPinnedModels(sortBy(validPinnedModels, ['group', 'name']))
    }
    loadPinnedModels()
  }, [providers])

  const togglePin = async (modelId: string) => {
    const newPinnedModels = pinnedModels.includes(modelId)
      ? pinnedModels.filter((id) => id !== modelId)
      : [...pinnedModels, modelId]

    await db.settings.put({ id: 'pinned:models', value: newPinnedModels })
    setPinnedModels(sortBy(newPinnedModels, ['group', 'name']))
  }

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
      const key = isPinned ? `${modelId}_pinned` : modelId
      const groupName = provider.isSystem ? t(`provider.${provider.id}`) : provider.name

      return {
        key,
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
            {first(model.name)}
          </Avatar>
        ),
        model,
        isPinned
      }
    },
    [t]
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
          name: t('models.pinned')
        })

        items.push(...pinnedItems)
      }
    }

    // 添加常规模型分组
    providers
      .filter((p) => {
        const filtered = getFilteredModels(p)
        return filtered.length > 0
      })
      .forEach((p) => {
        const filteredModels = getFilteredModels(p).filter(
          (m) => !pinnedModels.includes(getModelUniqId(m)) || searchText.length > 0
        )

        if (filteredModels.length === 0) return

        // 添加 provider 分组标题
        items.push({
          key: `provider-${p.id}`,
          type: 'group',
          name: p.isSystem ? t(`provider.${p.id}`) : p.name
        })

        items.push(...filteredModels.map((m) => createModelItem(m, p, pinnedModels.includes(getModelUniqId(m)))))
      })

    return items
  }, [providers, getFilteredModels, pinnedModels, searchText, t, createModelItem])

  // 获取可选择的模型项（过滤掉分组标题）
  const getSelectableItems = useCallback(() => {
    const items = listItems.filter((item) => item.type === 'model')
    return items
  }, [listItems])

  // 找到当前模型在列表中的索引（只在首次打开时设置）
  useEffect(() => {
    if (!hasAutoSelected.current && currentModelId && listItems.length > 0) {
      const index = listItems.findIndex(
        (item) => item.type === 'model' && getModelUniqId(item.model as Model) === currentModelId
      )

      if (index >= 0) {
        setSelectedItemKey(listItems[index].key)
        setFocusedItemKey(listItems[index].key)
        hasAutoSelected.current = true
      }
    }
  }, [currentModelId, listItems])

  // 滚动到聚焦项
  useEffect(() => {
    if (!focusedItemKey) return

    const actualIndex = listItems.findIndex((item) => item.key === focusedItemKey)
    if (actualIndex < 0) return

    if (!hasAutoScrolled.current) {
      listRef.current?.scrollTo({ index: actualIndex, align: 'center' })
      hasAutoScrolled.current = true
    } else {
      listRef.current?.scrollTo({ index: actualIndex, align: 'auto' })
    }
  }, [focusedItemKey, listItems])

  const handleItemClick = (item: FlatListItem) => {
    if (item.type !== 'model') return

    resolve(item.model)
    setOpen(false)
  }

  // 处理键盘导航
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open || listItems.length === 0) {
        return
      }

      const selectableItems = getSelectableItems()
      if (selectableItems.length === 0) {
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()

        const currentIndex = selectableItems.findIndex((item) => item.key === focusedItemKey)

        let nextIndex: number
        if (currentIndex === -1) {
          nextIndex = e.key === 'ArrowDown' ? 0 : selectableItems.length - 1
        } else {
          nextIndex =
            e.key === 'ArrowDown'
              ? (currentIndex + 1) % selectableItems.length
              : (currentIndex - 1 + selectableItems.length) % selectableItems.length
        }

        const nextItem = selectableItems[nextIndex]
        setFocusedItemKey(nextItem.key)
      } else if (e.key === 'Enter') {
        if (focusedItemKey) {
          e.preventDefault()
          const selectedItem = selectableItems.find((item) => item.key === focusedItemKey)
          if (selectedItem) {
            resolve(selectedItem.model)
            setOpen(false)
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        resolve(undefined)
      }
    },
    [open, listItems, focusedItemKey, getSelectableItems, resolve]
  )

  // 搜索文本改变时
  useEffect(() => {
    // 清除聚焦状态，但保留选中状态
    setFocusedItemKey('')

    // 根据新的搜索条件，重新找选中项
    hasAutoSelected.current = false
  }, [searchText])

  // 全局事件监听
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const onCancel = useCallback(() => {
    setOpen(false)
  }, [])

  const onClose = useCallback(async () => {
    resolve(undefined)
    SelectModelPopup.hide()
  }, [resolve])

  useEffect(() => {
    open && setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

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
          value={_searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          autoFocus
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

      {/* 虚拟列表 */}
      {listItems.length > 0 ? (
        <VirtualList
          ref={listRef}
          data={listItems}
          itemKey="key"
          height={listHeight}
          itemHeight={ITEM_HEIGHT}
          overscan={4}
          smoothScroll={true}
          styles={{
            verticalScrollBar: { background: 'transparent', width: 6 },
            verticalScrollBarThumb: {
              background: 'var(--color-scrollbar-thumb)',
              borderRadius: 4
            }
          }}>
          {(item) =>
            item.type === 'group' ? (
              <GroupItem>{item.name}</GroupItem>
            ) : (
              <ModelItem
                onClick={() => handleItemClick(item)}
                $isFocused={item.key === focusedItemKey}
                $isSelected={item.key === selectedItemKey}
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
            )
          }
        </VirtualList>
      ) : (
        <EmptyState>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </EmptyState>
      )}
    </Modal>
  )
}

const GroupItem = styled.div`
  font-size: 12px;
  font-weight: 500;
  padding: 5px 10px 5px 18px;
  color: var(--color-text-3);
  height: ${ITEM_HEIGHT}px;
  display: flex;
  align-items: center;
  position: relative;
  z-index: 1;
`

const ModelItem = styled.div<{ $isFocused: boolean; $isSelected: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  font-size: 14px;
  padding: 0 8px;
  margin: 1px 12px 1px 8px;
  height: ${ITEM_HEIGHT - 2}px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.3s;
  background-color: ${(props) => (props.$isFocused ? 'var(--color-background-mute)' : 'transparent')};

  ${(props) =>
    props.$isSelected &&
    css`
      margin-left: 5px;
      border-left: 3px solid var(--color-primary-soft);
      border-top-left-radius: 3px;
      border-bottom-left-radius: 3px;
    `}

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
