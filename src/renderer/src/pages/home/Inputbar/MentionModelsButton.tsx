import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { QuickPanelListItem } from '@renderer/components/QuickPanel/types'
import { getModelLogo, isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { Avatar, Tooltip } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { first, sortBy } from 'lodash'
import { AtSign, Plus } from 'lucide-react'
import { FC, memo, useCallback, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import styled from 'styled-components'

export interface MentionModelsButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<MentionModelsButtonRef | null>
  mentionModels: Model[]
  onMentionModel: (model: Model) => void
  ToolbarButton: any
}

const MentionModelsButton: FC<Props> = ({ ref, mentionModels, onMentionModel, ToolbarButton }) => {
  const { providers } = useProviders()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const quickPanel = useQuickPanel()

  const pinnedModels = useLiveQuery(
    async () => {
      const setting = await db.settings.get('pinned:models')
      return setting?.value || []
    },
    [],
    []
  )

  const modelItems = useMemo(() => {
    const items: QuickPanelListItem[] = []

    if (pinnedModels.length > 0) {
      const pinnedItems = providers.flatMap((p) =>
        p.models
          .filter((m) => !isEmbeddingModel(m) && !isRerankModel(m))
          .filter((m) => pinnedModels.includes(getModelUniqId(m)))
          .map((m) => ({
            label: (
              <>
                <ProviderName>{p.isSystem ? t(`provider.${p.id}`) : p.name}</ProviderName>
                <span style={{ opacity: 0.8 }}> | {m.name}</span>
              </>
            ),
            description: <ModelTagsWithLabel model={m} showLabel={false} size={10} style={{ opacity: 0.8 }} />,
            icon: (
              <Avatar src={getModelLogo(m.id)} size={20}>
                {first(m.name)}
              </Avatar>
            ),
            filterText: (p.isSystem ? t(`provider.${p.id}`) : p.name) + m.name,
            action: () => onMentionModel(m),
            isSelected: mentionModels.some((selected) => getModelUniqId(selected) === getModelUniqId(m))
          }))
      )

      if (pinnedItems.length > 0) {
        items.push(...sortBy(pinnedItems, ['label']))
      }
    }

    providers.forEach((p) => {
      const providerModels = p.models
        .filter((m) => !isEmbeddingModel(m) && !isRerankModel(m))
        .filter((m) => !pinnedModels.includes(getModelUniqId(m)))
        .map((m) => ({
          label: (
            <>
              <ProviderName>{p.isSystem ? t(`provider.${p.id}`) : p.name}</ProviderName>
              <span style={{ opacity: 0.8 }}> | {m.name}</span>
            </>
          ),
          description: <ModelTagsWithLabel model={m} showLabel={false} size={10} style={{ opacity: 0.8 }} />,
          icon: (
            <Avatar src={getModelLogo(m.id)} size={20}>
              {first(m.name)}
            </Avatar>
          ),
          filterText: (p.isSystem ? t(`provider.${p.id}`) : p.name) + m.name,
          action: () => onMentionModel(m),
          isSelected: mentionModels.some((selected) => getModelUniqId(selected) === getModelUniqId(m))
        }))

      if (providerModels.length > 0) {
        items.push(...sortBy(providerModels, ['label']))
      }
    })

    items.push({
      label: t('settings.models.add.add_model') + '...',
      icon: <Plus />,
      action: () => navigate('/settings/provider'),
      isSelected: false
    })

    return items
  }, [providers, t, pinnedModels, mentionModels, onMentionModel, navigate])

  const openQuickPanel = useCallback(() => {
    quickPanel.open({
      title: t('agents.edit.model.select.title'),
      list: modelItems,
      symbol: '@',
      multiple: true,
      afterAction({ item }) {
        item.isSelected = !item.isSelected
      }
    })
  }, [modelItems, quickPanel, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === '@') {
      quickPanel.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip placement="top" title={t('agents.edit.model.select.title')} arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        <AtSign size={18} />
      </ToolbarButton>
    </Tooltip>
  )
}

const ProviderName = styled.span`
  font-weight: 500;
`

export default memo(MentionModelsButton)
