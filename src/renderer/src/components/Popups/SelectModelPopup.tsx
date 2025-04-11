import { PushpinOutlined, SearchOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { getModelLogo, isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types' // Removed unused 'Provider' import
import { Avatar, Divider, Empty, Input, InputRef, Modal, Tooltip } from 'antd'
import { first, sortBy } from 'lodash'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react' // Added useMemo here
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { HStack } from '../Layout'
import ModelTags from '../ModelTags'
import Scrollbar from '../Scrollbar'
import ModelSettingsButton from './ModelSettingsButton'

interface Props {
  model?: Model // The currently active model, for highlighting
}

interface PopupContainerProps extends Props {
  resolve: (value: Model | undefined) => void
}

const PINNED_PROVIDER_ID = '__pinned__' // Special ID for pinned section

const PopupContainer: React.FC<PopupContainerProps> = ({ model: activeModel, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const inputRef = useRef<InputRef>(null)
  const { providers } = useProviders()
  const [pinnedModels, setPinnedModels] = useState<string[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>('all')
  // 移除未使用的状态

  // --- Load Pinned Models ---
  useEffect(() => {
    const loadPinnedModels = async () => {
      const setting = await db.settings.get('pinned:models')
      const savedPinnedModels = setting?.value || []
      const allModelIds = providers.flatMap((p) => p.models || []).map((m) => getModelUniqId(m))
      const validPinnedModels = savedPinnedModels.filter((id: string) => allModelIds.includes(id))
      if (validPinnedModels.length !== savedPinnedModels.length) {
        await db.settings.put({ id: 'pinned:models', value: validPinnedModels })
      }
      setPinnedModels(sortBy(validPinnedModels)) // Keep pinned models sorted if needed

      // Set initial selected provider
      if (activeModel) {
        const activeModelId = getModelUniqId(activeModel)
        if (validPinnedModels.includes(activeModelId)) {
          setSelectedProviderId(PINNED_PROVIDER_ID)
        } else {
          setSelectedProviderId(activeModel.provider)
        }
      } else if (validPinnedModels.length > 0) {
        setSelectedProviderId(PINNED_PROVIDER_ID)
      } else if (providers.length > 0) {
        setSelectedProviderId(providers[0].id)
      }
    }
    loadPinnedModels()
  }, [providers, activeModel]) // Depend on providers and activeModel

  // --- Pin/Unpin Logic ---
  const togglePin = useCallback(
    async (modelId: string) => {
      const newPinnedModels = pinnedModels.includes(modelId)
        ? pinnedModels.filter((id) => id !== modelId)
        : [...pinnedModels, modelId]

      await db.settings.put({ id: 'pinned:models', value: newPinnedModels })
      setPinnedModels(sortBy(newPinnedModels)) // Keep sorted

      // If unpinning the last pinned model and currently viewing pinned, switch provider
      if (newPinnedModels.length === 0 && selectedProviderId === PINNED_PROVIDER_ID) {
        setSelectedProviderId(providers[0]?.id || 'all')
      }
      // If pinning a model while viewing its provider, maybe switch to pinned? (Optional UX decision)
      // else if (!pinnedModels.includes(modelId) && selectedProviderId !== PINNED_PROVIDER_ID) {
      //   setSelectedProviderId(PINNED_PROVIDER_ID);
      // }
    },
    [pinnedModels, selectedProviderId, providers]
  )

  // 缓存所有模型列表，只在providers变化时重新计算
  const allModels = useMemo(() => {
    return providers.flatMap((p) => p.models || [])
      .filter((m) => !isEmbeddingModel(m) && !isRerankModel(m))
  }, [providers])

  // --- Filter Models for Right Column ---
  const displayedModels = useMemo(() => {
    let modelsToShow: Model[] = []

    // 如果有搜索文本，在所有模型中搜索
    if (searchText.trim()) {
      const keywords = searchText.toLowerCase().split(/\s+/).filter(Boolean)
      modelsToShow = allModels.filter((m) => {
        const provider = providers.find((p) => p.id === m.provider)
        const providerName = provider ? (provider.isSystem ? t(`provider.${provider.id}`) : provider.name) : ''
        const fullName = `${m.name} ${providerName}`.toLowerCase()
        return keywords.every((keyword) => fullName.includes(keyword))
      })
    } else {
      // 没有搜索文本时，根据选择的供应商筛选
      if (selectedProviderId === 'all') {
        // 显示所有模型
        modelsToShow = allModels
      } else if (selectedProviderId === PINNED_PROVIDER_ID) {
        // 显示固定的模型
        modelsToShow = allModels.filter((m) => pinnedModels.includes(getModelUniqId(m)))
      } else if (selectedProviderId) {
        // 显示选中供应商的模型
        const provider = providers.find((p) => p.id === selectedProviderId)
        if (provider && provider.models) {
          modelsToShow = provider.models.filter((m) => !isEmbeddingModel(m) && !isRerankModel(m))
        }
      }
    }

    return sortBy(modelsToShow, ['group', 'name'])
  }, [selectedProviderId, pinnedModels, searchText, allModels, providers, t])

  // --- Event Handlers ---
  const handleProviderSelect = useCallback((providerId: string) => {
    setSelectedProviderId(providerId)
  }, [])

  const handleModelSelect = useCallback((model: Model) => {
    resolve(model)
    setOpen(false)
  }, [resolve, setOpen])

  const onCancel = useCallback(() => {
    setOpen(false)
  }, [])

  const onClose = useCallback(async () => {
    resolve(undefined)
    SelectModelPopup.hide()
  }, [resolve])

  // --- Focus Input on Open ---
  useEffect(() => {
    open && setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  // --- Provider List for Left Column ---
  const providerListItems = useMemo(() => {
    const items: { id: string; name: string }[] = [
      { id: 'all', name: t('models.all') || '全部' } // 添加“全部”选项
    ]
    if (pinnedModels.length > 0) {
      items.push({ id: PINNED_PROVIDER_ID, name: t('models.pinned') })
    }
    providers.forEach((p) => {
      // Only add provider if it has non-embedding/rerank models
      if (p.models?.some((m) => !isEmbeddingModel(m) && !isRerankModel(m))) {
        items.push({ id: p.id, name: p.isSystem ? t(`provider.${p.id}`) : p.name })
      }
    })
    return items
  }, [providers, pinnedModels, t])

  // --- Render ---
  return (
    <Modal
      centered
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName=""
      styles={{
        content: {
          borderRadius: 15, // Adjusted border radius
          padding: 0,
          overflow: 'hidden',
          border: '1px solid var(--color-border)'
        },
        body: {
          padding: 0 // Remove default body padding
        }
      }}
      closeIcon={null}
      footer={null}
      width={900} // 进一步增加宽度，使界面更宽敞
    >
      {/* Search Input */}
      <SearchContainer onClick={() => inputRef.current?.focus()}>
        <SearchInputContainer>
          <Input
            prefix={
              <SearchIcon>
                <SearchOutlined />
              </SearchIcon>
            }
            ref={inputRef}
            placeholder={t('models.search')}
            value={searchText}
            onChange={useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
              const value = e.target.value
              setSearchText(value)
              // 当搜索时，自动选择"all"供应商，以显示所有匹配的模型
              if (value.trim() && selectedProviderId !== 'all') {
                setSelectedProviderId('all')
              }
            }, [selectedProviderId, t])}
            // 移除焦点事件处理
            allowClear
            autoFocus
            style={{
              paddingLeft: 0,
              height: '32px',
              fontSize: '14px'
            }}
            variant="borderless"
            size="middle"
          />
        </SearchInputContainer>
      </SearchContainer>
      <Divider style={{ margin: 0, borderBlockStartWidth: 0.5, marginTop: -5 }} />

      {/* Two Column Layout */}
      <TwoColumnContainer>
        {/* Left Column: Providers */}
        <ProviderListColumn>
          <Scrollbar style={{ height: '60vh', paddingRight: '5px' }}>
            {providerListItems.map((provider, index) => (
              <React.Fragment key={provider.id}>
                <Tooltip title={provider.name} placement="right" mouseEnterDelay={0.5}>
                  <ProviderListItem
                    $selected={selectedProviderId === provider.id}
                    onClick={() => handleProviderSelect(provider.id)}>
                    <ProviderName>{provider.name}</ProviderName>
                    {provider.id === PINNED_PROVIDER_ID && <PinnedIcon />}
                  </ProviderListItem>
                </Tooltip>
                {/* 在每个供应商之后添加分割线，除了最后一个 */}
                {index < providerListItems.length - 1 && <ProviderDivider />}
              </React.Fragment>
            ))}
          </Scrollbar>
        </ProviderListColumn>

        {/* Right Column: Models */}
        <ModelListColumn>
          <Scrollbar style={{ height: '60vh', paddingRight: '5px' }}>
            {displayedModels.length > 0 ? (
              displayedModels.map((m) => (
                <ModelListItem
                  key={getModelUniqId(m)}
                  $selected={activeModel ? getModelUniqId(activeModel) === getModelUniqId(m) : false}
                  onClick={() => handleModelSelect(m)}>
                  <Avatar src={getModelLogo(m?.id || '')} size={24}>
                    {first(m?.name)}
                  </Avatar>
                  <ModelDetails>
                    <ModelNameRow>
                      <Tooltip title={m?.name} mouseEnterDelay={0.5}>
                        <span className="model-name">{m?.name}</span>
                      </Tooltip>
                      {/* Show provider only if not in pinned view or if search is active */}
                      {(selectedProviderId !== PINNED_PROVIDER_ID || searchText) && (
                        <Tooltip title={providers.find((p) => p.id === m.provider)?.name ?? m.provider} mouseEnterDelay={0.5}>
                          <span className="provider-name">
                            | {providers.find((p) => p.id === m.provider)?.name ?? m.provider}
                          </span>
                        </Tooltip>
                      )}
                      <ModelTags model={m} />
                    </ModelNameRow>
                  </ModelDetails>
                  <ActionButtons>
                    <ModelSettingsButton model={m} size={14} className="settings-button" />
                    <PinButton
                      $isPinned={pinnedModels.includes(getModelUniqId(m))}
                      onClick={(e) => {
                        e.stopPropagation() // Prevent model selection when clicking pin
                        togglePin(getModelUniqId(m))
                      }}>
                      <PushpinOutlined />
                    </PinButton>
                  </ActionButtons>
                </ModelListItem>
              ))
            ) : (
              <EmptyState>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('models.no_matches')} />
              </EmptyState>
            )}
          </Scrollbar>
        </ModelListColumn>
      </TwoColumnContainer>
    </Modal>
  )
}

// --- Styled Components ---

const SearchContainer = styled(HStack)`
  padding: 8px 15px;
  cursor: pointer;
`

const SearchInputContainer = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
`

const SearchIcon = styled.div`
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background-soft);
  margin-right: 5px;
  color: var(--color-icon);
  font-size: 14px;
  flex-shrink: 0;

  &:hover {
    background-color: var(--color-background-mute);
  }
`

const TwoColumnContainer = styled.div`
  display: flex;
  height: 60vh; // 增加高度
`

const ProviderListColumn = styled.div`
  width: 200px; // 减小宽度到200px
  border-right: 0.5px solid var(--color-border);
  padding: 15px 10px; // 减小内边距
  box-sizing: border-box;
  background-color: var(--color-background-soft); // Slight background difference
`

const ProviderListItem = styled.div<{ $selected: boolean }>`
  padding: 10px 12px; // 增加上下内边距
  cursor: pointer;
  border-radius: 8px; // 减小圆角
  margin-bottom: 8px; // 增加下边距
  font-size: 14px; // 减小字体大小
  font-weight: ${(props) => (props.$selected ? '600' : '400')};
  background-color: ${(props) => (props.$selected ? 'var(--color-background-mute)' : 'transparent')};
  color: ${(props) => (props.$selected ? 'var(--color-text-primary)' : 'var(--color-text)')};
  display: flex;
  align-items: center;
  justify-content: space-between; // To push pin icon to the right for "Pinned"
  overflow: hidden; // 防止文本溢出
  text-overflow: ellipsis; // 溢出显示省略号
  white-space: nowrap; // 不换行

  &:hover {
    background-color: var(--color-background-mute);
  }
`

const ModelListColumn = styled.div`
  flex: 1;
  padding: 12px; // 减小内边距
  box-sizing: border-box;
`

const ModelListItem = styled.div<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  padding: 8px 12px; // 进一步减小内边距
  margin-bottom: 6px; // 进一步减小下边距
  border-radius: 6px; // 进一步减小圆角
  cursor: pointer;
  background-color: ${(props) => (props.$selected ? 'var(--color-background-mute)' : 'transparent')};

  &:hover {
    background-color: var(--color-background-mute);
    .pin-button, .settings-button {
      opacity: 0.5; // Show buttons on hover
    }
  }

  .pin-button, .settings-button {
    opacity: ${(props) => (props.$selected ? 0.5 : 0)}; // Show if selected or hovered
    transition: opacity 0.2s;
    &:hover {
      opacity: 1 !important; // Full opacity on direct hover
    }
  }
`

const ModelDetails = styled.div`
  margin-left: 10px; // 进一步减小左边距
  flex: 1;
  overflow: hidden; // Prevent long names from breaking layout
`

const ModelNameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px; // 进一步减小间距
  font-size: 13px; // 进一步减小字体大小

  .model-name {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px; // 进一步减小最大宽度
  }
  .provider-name {
    color: var(--color-text-secondary);
    font-size: 11px; // 进一步减小字体大小
    white-space: nowrap;
    overflow: hidden; // 防止文本溢出
    text-overflow: ellipsis; // 溢出显示省略号
    max-width: 120px; // 增加最大宽度
  }
`
const ActionButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 4px; // 进一步减小间距
  margin-left: auto; // Push to the right
`

const PinButton = styled.button<{ $isPinned: boolean }>`
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px; // 进一步减小内边距
  color: ${(props) => (props.$isPinned ? 'var(--color-primary)' : 'var(--color-icon)')};
  transform: ${(props) => (props.$isPinned ? 'rotate(-45deg)' : 'none')};
  font-size: 14px; // 进一步减小图标大小
  line-height: 1; // Ensure icon aligns well

  &:hover {
    color: ${(props) => (props.$isPinned ? 'var(--color-primary)' : 'var(--color-text-primary)')};
  }
`

const EmptyState = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  color: var(--color-text-secondary);
`

const ProviderName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
`

const PinnedIcon = styled(PushpinOutlined)`
  margin-left: auto;
  flex-shrink: 0;
`

const ProviderDivider = styled.div`
  height: 1px;
  background-color: var(--color-border);
  margin: 8px 0;
  opacity: 0.5;
`

// --- Export Class ---
export default class SelectModelPopup {
  static hide() {
    TopView.hide('SelectModelPopup')
  }
  static show(params: Props) {
    return new Promise<Model | undefined>((resolve) => {
      // 直接显示新的弹窗，不使用setTimeout
      TopView.show(<PopupContainer {...params} resolve={resolve} />, 'SelectModelPopup')
    })
  }
}
