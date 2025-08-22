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
import { AtSign, CircleX, Plus } from 'lucide-react'
import { FC, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import styled from 'styled-components'

export interface MentionModelsButtonRef {
  openQuickPanel: (triggerInfo?: { type: 'input' | 'button'; position?: number; originalText?: string }) => void
}

interface Props {
  ref?: React.RefObject<MentionModelsButtonRef | null>
  mentionedModels: Model[]
  onMentionModel: (model: Model) => void
  onClearMentionModels: () => void
  couldMentionNotVisionModel: boolean
  files: FileType[]
  ToolbarButton: any
  setText: React.Dispatch<React.SetStateAction<string>>
}

const MentionModelsButton: FC<Props> = ({
  ref,
  mentionedModels,
  onMentionModel,
  onClearMentionModels,
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

    items.unshift({
      label: t('settings.input.clear.all'),
      description: t('settings.input.clear.models'),
      icon: <CircleX />,
      isSelected: false,
      action: () => {
        onClearMentionModels()
        quickPanel.close()
      }
    })

    return items
  }, [
    pinnedModels,
    providers,
    t,
    couldMentionNotVisionModel,
    mentionedModels,
    onMentionModel,
    navigate,
    quickPanel,
    onClearMentionModels
  ])

  const openQuickPanel = useCallback(
    (triggerInfo?: { type: 'input' | 'button'; position?: number; originalText?: string }) => {
      // 重置模型动作标记
      hasModelActionRef.current = false

      quickPanel.open({
        title: t('agents.edit.model.select.title'),
        list: modelItems,
        symbol: '@',
        multiple: true,
        triggerInfo: triggerInfo || { type: 'button' },
        afterAction({ item }) {
          item.isSelected = !item.isSelected
        },
        onClose({ action, triggerInfo: closeTriggerInfo, searchText }) {
          // ESC关闭时的处理：删除 @ 和搜索文本
          if (action === 'esc') {
            // 只有在输入触发且有模型选择动作时才删除@字符和搜索文本
            if (
              hasModelActionRef.current &&
              closeTriggerInfo?.type === 'input' &&
              closeTriggerInfo?.position !== undefined
            ) {
              // 使用React的setText来更新状态
              setText((currentText) => {
                const position = closeTriggerInfo.position!
                // 验证位置的字符是否仍是 @
                if (currentText[position] !== '@') {
                  return currentText
                }

                // 计算删除范围：@ + searchText
                const deleteLength = 1 + (searchText?.length || 0)

                // 验证要删除的内容是否匹配预期
                const expectedText = '@' + (searchText || '')
                const actualText = currentText.slice(position, position + deleteLength)

                if (actualText !== expectedText) {
                  // 如果实际文本不匹配，只删除 @ 字符
                  return currentText.slice(0, position) + currentText.slice(position + 1)
                }

                // 删除 @ 和搜索文本
                return currentText.slice(0, position) + currentText.slice(position + deleteLength)
              })
            }
          }
          // Backspace删除@的情况（delete-symbol）：
          // @ 已经被Backspace自然删除，面板关闭，不需要额外操作
        }
      })
    },
    [modelItems, quickPanel, t, setText]
  )

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === '@') {
      quickPanel.close()
    } else {
      openQuickPanel({ type: 'button' })
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
