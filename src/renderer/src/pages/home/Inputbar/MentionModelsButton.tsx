import { PushpinOutlined } from '@ant-design/icons'
import ModelTags from '@renderer/components/ModelTags'
import { getModelLogo, isEmbeddingModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { Avatar, Dropdown, Tooltip } from 'antd'
import { first, sortBy } from 'lodash'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { createGlobalStyle } from 'styled-components'

interface Props {
  mentionModels: Model[]
  onMentionModel: (model: Model) => void
  ToolbarButton: any
}

const MentionModelsButton: FC<Props> = ({ onMentionModel: onSelect, ToolbarButton }) => {
  const { providers } = useProviders()
  const [pinnedModels, setPinnedModels] = useState<string[]>([])
  const { t } = useTranslation()

  useEffect(() => {
    const loadPinnedModels = async () => {
      const setting = await db.settings.get('pinned:models')
      setPinnedModels(setting?.value || [])
    }
    loadPinnedModels()
  }, [])

  const togglePin = async (modelId: string) => {
    const newPinnedModels = pinnedModels.includes(modelId)
      ? pinnedModels.filter((id) => id !== modelId)
      : [...pinnedModels, modelId]

    await db.settings.put({ id: 'pinned:models', value: newPinnedModels })
    setPinnedModels(newPinnedModels)
  }

  const modelMenuItems = providers
    .filter((p) => p.models && p.models.length > 0)
    .map((p) => {
      const filteredModels = sortBy(p.models, ['group', 'name'])
        .filter((m) => !isEmbeddingModel(m))
        .map((m) => ({
          key: getModelUniqId(m),
          label: (
            <ModelItem>
              <ModelNameRow>
                <span>{m?.name}</span> <ModelTags model={m} />
              </ModelNameRow>
              {/* <Checkbox checked={selectedModels.some((sm) => sm.id === m.id)} /> */}
              <PinIcon
                onClick={(e) => {
                  e.stopPropagation()
                  togglePin(getModelUniqId(m))
                }}
                $isPinned={pinnedModels.includes(getModelUniqId(m))}>
                <PushpinOutlined />
              </PinIcon>
            </ModelItem>
          ),
          icon: (
            <Avatar src={getModelLogo(m.id)} size={24}>
              {first(m.name)}
            </Avatar>
          ),
          onClick: () => {
            onSelect(m)
          }
        }))

      return filteredModels.length > 0
        ? {
            key: p.id,
            label: p.isSystem ? t(`provider.${p.id}`) : p.name,
            type: 'group' as const,
            children: filteredModels
          }
        : null
    })
    .filter(Boolean)

  if (pinnedModels.length > 0) {
    const pinnedItems = modelMenuItems
      .flatMap((p) => p?.children || [])
      .filter((m) => pinnedModels.includes(m.key))
      .map((m) => ({ ...m, key: m.key + 'pinned' }))

    if (pinnedItems.length > 0) {
      modelMenuItems.unshift({
        key: 'pinned',
        label: t('models.pinned'),
        type: 'group' as const,
        children: pinnedItems
      })
    }
  }

  return (
    <>
      <DropdownMenuStyle />
      <Dropdown menu={{ items: modelMenuItems }} trigger={['click']} overlayClassName="mention-models-dropdown">
        <Tooltip placement="top" title={t('agents.edit.model.select.title')} arrow>
          <ToolbarButton type="text">
            <i className="iconfont icon-at" style={{ fontSize: 18 }}></i>
          </ToolbarButton>
        </Tooltip>
      </Dropdown>
    </>
  )
}

const DropdownMenuStyle = createGlobalStyle`
  .mention-models-dropdown {
    .ant-dropdown-menu {
      max-height: 400px;
    }
  }
`

const ModelItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  width: 100%;
  gap: 16px;

  &:hover {
    .pin-icon {
      opacity: 0.3;
    }
  }
`

const ModelNameRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`

const PinIcon = styled.span.attrs({ className: 'pin-icon' })<{ $isPinned: boolean }>`
  margin-left: auto;
  padding: 0 8px;
  opacity: ${(props) => (props.$isPinned ? 1 : 'inherit')};
  transition: opacity 0.2s;
  right: 0;
  color: ${(props) => (props.$isPinned ? 'var(--color-primary)' : 'inherit')};
  transform: ${(props) => (props.$isPinned ? 'rotate(-45deg)' : 'none')};
  opacity: 0;

  &:hover {
    opacity: 1 !important;
    color: ${(props) => (props.$isPinned ? 'var(--color-primary)' : 'inherit')};
  }
`

export default MentionModelsButton
