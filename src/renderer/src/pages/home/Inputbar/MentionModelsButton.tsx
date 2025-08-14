import { getModelLogo, isEmbeddingModel, isRerankModel, isVisionModel } from '@renderer/config/models'
import ModelLabels from '@renderer/components/ModelLabels'
import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import { QuickPanelListItem, useQuickPanel } from '@renderer/components/QuickPanel'
import db from '@renderer/databases'
import { usePinnedModels } from '@renderer/hooks/usePinnedModels'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { FileType, Model } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { Avatar, Tooltip } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { first, sortBy } from 'lodash'
import { AtSign, Plus } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import styled from 'styled-components'

import { ToolbarButton } from './Inputbar'

export interface MentionModelsButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<MentionModelsButtonRef | null>
  mentionedModels: Model[]
  onMentionModel: (model: Model) => void
  couldMentionNotVisionModel: boolean
  files: FileType[]
  ToolbarButton: any
}

const MentionModelsButton = forwardRef<MentionModelsButtonRef, Props>(({
  mentionedModels,
  onMentionModel,
  couldMentionNotVisionModel,
  files,
  ToolbarButton
}, ref) => {
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
          .filter((m) => couldMentionNotVisionModel || (!couldMentionNotVisionModel && isVisionModel(m)))
          .map((m) => ({
            label: (
              <>
                <ProviderName>{getFancyProviderName(p)}</ProviderName>
                <span style={{ opacity: 0.8 }}> | {m.name}</span>
              </>
            ),
            description: <ModelTagsWithLabel model={m} showLabel={false} size={10} showTooltip={true} style={{ opacity: 0.8 }} />,
            icon: (
              <Avatar src={getModelLogo(m.id)} size={20}>
                {first(m.name)}
              </Avatar>
            ),
            filterText: getFancyProviderName(p) + m.name,
            action: () => onMentionModel(m),
            isSelected: mentionedModels.some((selected) => getModelUniqId(selected) === getModelUniqId(m))
          }))
      )

      if (pinnedItems.length > 0) {
        items.push(...sortBy(pinnedItems, ['label']))
      }
    }

    providers.forEach((p) => {
      const providerModels = sortBy(
        p.models
          .filter((m) => !isEmbeddingModel(m) && !isRerankModel(m))
          .filter((m) => !pinnedModels.includes(getModelUniqId(m)))
          .filter((m) => couldMentionNotVisionModel || (!couldMentionNotVisionModel && isVisionModel(m))),
        ['group', 'name']
      )

      const providerModelItems = providerModels.map((m) => ({
        label: (
          <>
            <ProviderName>{getFancyProviderName(p)}</ProviderName>
            <span style={{ opacity: 0.8, display: 'flex', alignItems: 'center', gap: 4 }}> | {m.name}</span>
            <ModelLabels model={m} />
          </>
        ),
            description: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <ModelTagsWithLabel model={m} showLabel={false} size={10} showTooltip={true} style={{ opacity: 0.8 }} />
                <ModelLabels model={m} />
              </div>
            ),
        icon: (
          <Avatar src={getModelLogo(m.id)} size={20}>
            {first(m.name)}
          </Avatar>
        ),
        filterText: getFancyProviderName(p) + m.name,
        action: () => onMentionModel(m),
        isSelected: mentionedModels.some((selected) => getModelUniqId(selected) === getModelUniqId(m))
      }))

      if (providerModelItems.length > 0) {
        items.push(...providerModelItems)
      }
    })

    items.push({
      label: t('settings.models.add.add_model') + '...',
      icon: <Plus />,
      action: () => navigate('/settings/provider'),
      isSelected: false
    })

    return items
  }, [pinnedModels, providers, t, couldMentionNotVisionModel, mentionedModels, onMentionModel, navigate])

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

  const filesRef = useRef(files)

  useEffect(() => {
    // 检查files是否变化
    if (filesRef.current !== files) {
      if (quickPanel.isVisible && quickPanel.symbol === '@') {
        quickPanel.close()
      }
      filesRef.current = files
    }
  }, [files, quickPanel])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip placement="top" title={t('agents.edit.model.select.title')} mouseLeaveDelay={0} arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        <AtSign size={18} />
      </ToolbarButton>
    </Tooltip>
  )
})

const ProviderName = styled.span`
  font-weight: 500;
`

export default MentionModelsButton
