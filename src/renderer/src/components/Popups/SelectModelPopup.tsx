import { PushpinOutlined, SearchOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { getModelLogo, isEmbeddingModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { Avatar, Divider, Empty, Input, InputRef, Menu, MenuProps, Modal } from 'antd'
import { first, sortBy } from 'lodash'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { HStack } from '../Layout'
import ModelTags from '../ModelTags'
import Scrollbar from '../Scrollbar'

type MenuItem = Required<MenuProps>['items'][number]

interface Props {
  model?: Model
}

interface PopupContainerProps extends Props {
  resolve: (value: Model | undefined) => void
}

const PopupContainer: React.FC<PopupContainerProps> = ({ model, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<InputRef>(null)
  const { providers } = useProviders()
  const [pinnedModels, setPinnedModels] = useState<string[]>([])
  const scrollContainerRef = useRef<HTMLDivElement>(null)

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

  const filteredItems: MenuItem[] = providers
    .filter((p) => p.models && p.models.length > 0)
    .map((p) => {
      const filteredModels = sortBy(p.models, ['group', 'name'])
        .filter((m) => !isEmbeddingModel(m))
        .filter((m) =>
          [m.name + m.provider + t('provider.' + p.id)].join('').toLowerCase().includes(searchText.toLowerCase())
        )
        .map((m) => ({
          key: getModelUniqId(m),
          label: (
            <ModelItem>
              <ModelNameRow>
                <span>{m?.name}</span> <ModelTags model={m} />
              </ModelNameRow>
              <PinIcon
                onClick={(e) => {
                  e.stopPropagation()
                  togglePin(getModelUniqId(m))
                }}
                isPinned={pinnedModels.includes(getModelUniqId(m))}>
                <PushpinOutlined />
              </PinIcon>
            </ModelItem>
          ),
          icon: (
            <Avatar src={getModelLogo(m?.id || '')} size={24}>
              {first(m?.name)}
            </Avatar>
          ),
          onClick: () => {
            resolve(m)
            setOpen(false)
          }
        }))

      // Only return the group if it has filtered models
      return filteredModels.length > 0
        ? {
            key: p.id,
            label: p.isSystem ? t(`provider.${p.id}`) : p.name,
            type: 'group',
            children: filteredModels
          }
        : null
    })
    .filter(Boolean) as MenuItem[] // Filter out null items

  if (pinnedModels.length > 0 && searchText.length === 0) {
    const pinnedItems = providers
      .flatMap((p) => p.models || [])
      .filter((m) => pinnedModels.includes(getModelUniqId(m)))
      .map((m) => ({
        key: getModelUniqId(m) + '_pinned',
        label: (
          <ModelItem>
            <ModelNameRow>
              <span>{m?.name}</span> <ModelTags model={m} />
            </ModelNameRow>
            <PinIcon
              onClick={(e) => {
                e.stopPropagation()
                togglePin(getModelUniqId(m))
              }}
              isPinned={true}>
              <PushpinOutlined />
            </PinIcon>
          </ModelItem>
        ),
        icon: (
          <Avatar src={getModelLogo(m?.id || '')} size={24}>
            {first(m?.name)}
          </Avatar>
        ),
        onClick: () => {
          resolve(m)
          setOpen(false)
        }
      }))

    if (pinnedItems.length > 0) {
      filteredItems.unshift({
        key: 'pinned',
        label: t('models.pinned'),
        type: 'group',
        children: pinnedItems
      } as MenuItem)
    }
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = async () => {
    resolve(undefined)
    SelectModelPopup.hide()
  }

  useEffect(() => {
    open && setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (open && model) {
      setTimeout(() => {
        const selectedElement = document.querySelector('.ant-menu-item-selected')
        if (selectedElement && scrollContainerRef.current) {
          selectedElement.scrollIntoView({ block: 'center', behavior: 'auto' })
        }
      }, 100) // Small delay to ensure menu is rendered
    }
  }, [open, model])

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
          placeholder={t('models.search')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          autoFocus
          style={{ paddingLeft: 0 }}
          bordered={false}
          size="middle"
        />
      </HStack>
      <Divider style={{ margin: 0, borderBlockStartWidth: 0.5 }} />
      <Scrollbar style={{ height: '50vh' }} ref={scrollContainerRef}>
        <Container>
          {filteredItems.length > 0 ? (
            <StyledMenu
              items={filteredItems}
              selectedKeys={model ? [getModelUniqId(model)] : []}
              mode="inline"
              inlineIndent={6}
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

  .ant-menu-item-group-title {
    padding: 5px 10px 0;
    font-size: 12px;
  }

  .ant-menu-item {
    height: 36px;
    line-height: 36px;

    &.ant-menu-item-selected {
      background-color: var(--color-background-mute) !important;
      color: var(--color-text-primary) !important;
    }

    &:not([data-menu-id^='pinned-']) {
      .pin-icon {
        opacity: 0;
      }

      &:hover {
        .pin-icon {
          opacity: 0.3;
        }
      }
    }
  }
`

const ModelItem = styled.div`
  display: flex;
  align-items: center;
  font-size: 14px;
  position: relative;
  width: 100%;
`

const ModelNameRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
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

const PinIcon = styled.span.attrs({ className: 'pin-icon' })<{ isPinned: boolean }>`
  margin-left: auto;
  padding: 0 8px;
  opacity: ${(props) => (props.isPinned ? 1 : 'inherit')};
  transition: opacity 0.2s;
  position: absolute;
  right: 0;
  color: ${(props) => (props.isPinned ? 'var(--color-primary)' : 'inherit')};
  transform: ${(props) => (props.isPinned ? 'rotate(-45deg)' : 'none')};

  &:hover {
    opacity: 1 !important;
    color: ${(props) => (props.isPinned ? 'var(--color-primary)' : 'inherit')};
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
