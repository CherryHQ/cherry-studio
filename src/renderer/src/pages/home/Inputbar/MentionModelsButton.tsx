import { PlusOutlined } from '@ant-design/icons'
import ModelTags from '@renderer/components/ModelTags'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { QuickPanelListItem } from '@renderer/components/QuickPanel/types'
import { getModelLogo, isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { Avatar, Tooltip } from 'antd'
import { first, sortBy } from 'lodash'
import { FC, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

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
  const [pinnedModels, setPinnedModels] = useState<string[]>([])
  const { t } = useTranslation()
  const navigate = useNavigate()
  const quickPanel = useQuickPanel()

  const modelItems = useMemo(() => {
    // Get all models from providers
    const allModels = providers
      .filter((p) => p.models && p.models.length > 0)
      .flatMap((p) =>
        p.models
          .filter((m) => !isEmbeddingModel(m))
          .filter((m) => !isRerankModel(m))
          .map((m) => ({
            model: m,
            provider: p,
            isPinned: pinnedModels.includes(getModelUniqId(m))
          }))
      )

    // Sort by pinned status and name
    const newList: QuickPanelListItem[] = sortBy(allModels, ['isPinned', 'model.name'])
      .reverse()
      .map((item) => ({
        label: `${item.provider.isSystem ? t(`provider.${item.provider.id}`) : item.provider.name} | ${item.model.name}`,
        description: <ModelTags model={item.model} />,
        icon: (
          <Avatar src={getModelLogo(item.model.id)} size={20}>
            {first(item.model.name)}
          </Avatar>
        ),
        action: () => onMentionModel(item.model),
        isSelected: mentionModels.some((selected) => getModelUniqId(selected) === getModelUniqId(item.model))
      }))
    newList.push({
      label: t('settings.models.add.add_model') + '...',
      icon: <PlusOutlined />,
      action: () => navigate('/settings/provider'),
      isSelected: false
    })
    return newList
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

  useEffect(() => {
    const loadPinnedModels = async () => {
      const setting = await db.settings.get('pinned:models')
      setPinnedModels(setting?.value || [])
    }
    loadPinnedModels()
  }, [])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip placement="top" title={t('agents.edit.model.select.title')} arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        <i className="iconfont icon-at" style={{ fontSize: 18 }}></i>
      </ToolbarButton>
    </Tooltip>
  )
}

export default MentionModelsButton
