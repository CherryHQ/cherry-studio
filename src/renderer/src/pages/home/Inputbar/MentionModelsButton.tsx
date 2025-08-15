import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { QuickPanelListItem } from '@renderer/components/QuickPanel/types'
import { getModelLogo, isEmbeddingModel, isRerankModel, isVisionModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { FileType, Model } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { Avatar, Tooltip } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { first, sortBy } from 'lodash'
import { AtSign, Plus } from 'lucide-react'
import { FC, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import styled from 'styled-components'

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
  setText: React.Dispatch<React.SetStateAction<string>>
}

const MentionModelsButton: FC<Props> = ({
  ref,
  mentionedModels,
  onMentionModel,
  couldMentionNotVisionModel,
  files,
  ToolbarButton,
  setText
}) => {
  const { providers } = useProviders()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const quickPanel = useQuickPanel()

  // 记录是否有模型被选择的动作发生
  const hasModelActionRef = useRef<boolean>(false)

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
            description: <ModelTagsWithLabel model={m} showLabel={false} size={10} style={{ opacity: 0.8 }} />,
            icon: (
              <Avatar src={getModelLogo(m.id)} size={20}>
                {first(m.name)}
              </Avatar>
            ),
            filterText: getFancyProviderName(p) + m.name,
            action: () => {
              hasModelActionRef.current = true // 标记有模型动作发生
              onMentionModel(m)
            },
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
            <span style={{ opacity: 0.8 }}> | {m.name}</span>
          </>
        ),
        description: <ModelTagsWithLabel model={m} showLabel={false} size={10} style={{ opacity: 0.8 }} />,
        icon: (
          <Avatar src={getModelLogo(m.id)} size={20}>
            {first(m.name)}
          </Avatar>
        ),
        filterText: getFancyProviderName(p) + m.name,
        action: () => {
          hasModelActionRef.current = true // 标记有模型动作发生
          onMentionModel(m)
        },
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
    // 重置模型动作标记
    hasModelActionRef.current = false

    quickPanel.open({
      title: t('agents.edit.model.select.title'),
      list: modelItems,
      symbol: '@',
      multiple: true,
      afterAction({ item }) {
        item.isSelected = !item.isSelected
      },
      onClose({ action }) {
        // ESC或Backspace关闭时的特殊处理
        if (action === 'esc' || action === 'delete-symbol') {
          // 如果有模型选择动作发生，删除@字符
          if (hasModelActionRef.current) {
            // 使用React的setText来更新状态，而不是直接操作DOM
            setText((currentText) => {
              const lastAtIndex = currentText.lastIndexOf('@')
              if (lastAtIndex !== -1) {
                return currentText.slice(0, lastAtIndex) + currentText.slice(lastAtIndex + 1)
              }
              return currentText
            })
          }
        }
      }
    })
  }, [modelItems, quickPanel, t, setText])

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
        <AtSign size={18} color={mentionedModels.length > 0 ? 'var(--color-primary)' : 'var(--color-icon)'} />
      </ToolbarButton>
    </Tooltip>
  )
}

const ProviderName = styled.span`
  font-weight: 500;
`

export default memo(MentionModelsButton)
