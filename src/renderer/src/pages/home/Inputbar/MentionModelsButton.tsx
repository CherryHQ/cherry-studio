import { ActionIconButton } from '@renderer/components/Buttons'
import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import { QuickPanelListItem, QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { getModelLogo, isEmbeddingModel, isRerankModel, isVisionModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import { getModelUniqId } from '@renderer/services/ModelService'
import { FileType, Model } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { Avatar, Tooltip } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { first, sortBy } from 'lodash'
import { AtSign, CircleX, Plus } from 'lucide-react'
import { FC, memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import styled from 'styled-components'

type MentionTriggerInfo = { type: 'input' | 'button'; position?: number; originalText?: string }

interface Props {
  quickPanel: ToolQuickPanelApi
  mentionedModels: Model[]
  onMentionModel: (model: Model) => void
  onClearMentionModels: () => void
  couldMentionNotVisionModel: boolean
  files: FileType[]
  setText: React.Dispatch<React.SetStateAction<string>>
}

const MentionModelsButton: FC<Props> = ({
  quickPanel,
  mentionedModels,
  onMentionModel,
  onClearMentionModels,
  couldMentionNotVisionModel,
  files,
  setText
}) => {
  const quickPanelHook = useQuickPanel()
  const { providers } = useProviders()
  const { t } = useTranslation()
  const navigate = useNavigate()

  const hasModelActionRef = useRef(false)
  const triggerInfoRef = useRef<MentionTriggerInfo | undefined>(undefined)
  const filesRef = useRef(files)

  const removeAtSymbolAndText = useCallback(
    (currentText: string, caretPosition: number, searchText?: string, fallbackPosition?: number) => {
      const safeCaret = Math.max(0, Math.min(caretPosition ?? 0, currentText.length))

      if (searchText !== undefined) {
        const pattern = '@' + searchText
        const fromIndex = Math.max(0, safeCaret - 1)
        const start = currentText.lastIndexOf(pattern, fromIndex)
        if (start !== -1) {
          const end = start + pattern.length
          return currentText.slice(0, start) + currentText.slice(end)
        }

        if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === '@') {
          const expected = pattern
          const actual = currentText.slice(fallbackPosition, fallbackPosition + expected.length)
          if (actual === expected) {
            return currentText.slice(0, fallbackPosition) + currentText.slice(fallbackPosition + expected.length)
          }
          return currentText.slice(0, fallbackPosition) + currentText.slice(fallbackPosition + 1)
        }

        return currentText
      }

      const fromIndex = Math.max(0, safeCaret - 1)
      const start = currentText.lastIndexOf('@', fromIndex)
      if (start === -1) {
        if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === '@') {
          let endPos = fallbackPosition + 1
          while (endPos < currentText.length && !/\s/.test(currentText[endPos])) {
            endPos++
          }
          return currentText.slice(0, fallbackPosition) + currentText.slice(endPos)
        }
        return currentText
      }

      let endPos = start + 1
      while (endPos < currentText.length && !/\s/.test(currentText[endPos])) {
        endPos++
      }
      return currentText.slice(0, start) + currentText.slice(endPos)
    },
    []
  )

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
      const pinnedItems = providers.flatMap((provider) =>
        provider.models
          .filter((model) => !isEmbeddingModel(model) && !isRerankModel(model))
          .filter((model) => pinnedModels.includes(getModelUniqId(model)))
          .filter((model) => couldMentionNotVisionModel || (!couldMentionNotVisionModel && isVisionModel(model)))
          .map((model) => ({
            label: (
              <>
                <ProviderName>{getFancyProviderName(provider)}</ProviderName>
                <span style={{ opacity: 0.8 }}> | {model.name}</span>
              </>
            ),
            description: <ModelTagsWithLabel model={model} showLabel={false} size={10} style={{ opacity: 0.8 }} />,
            icon: (
              <Avatar src={getModelLogo(model.id)} size={20}>
                {first(model.name)}
              </Avatar>
            ),
            filterText: getFancyProviderName(provider) + model.name,
            action: () => {
              hasModelActionRef.current = true
              onMentionModel(model)
            },
            isSelected: mentionedModels.some((selected) => getModelUniqId(selected) === getModelUniqId(model))
          }))
      )

      if (pinnedItems.length > 0) {
        items.push(...sortBy(pinnedItems, ['label']))
      }
    }

    providers.forEach((provider) => {
      const providerModels = sortBy(
        provider.models
          .filter((model) => !isEmbeddingModel(model) && !isRerankModel(model))
          .filter((model) => !pinnedModels.includes(getModelUniqId(model)))
          .filter((model) => couldMentionNotVisionModel || (!couldMentionNotVisionModel && isVisionModel(model))),
        ['group', 'name']
      )

      const providerItems = providerModels.map((model) => ({
        label: (
          <>
            <ProviderName>{getFancyProviderName(provider)}</ProviderName>
            <span style={{ opacity: 0.8 }}> | {model.name}</span>
          </>
        ),
        description: <ModelTagsWithLabel model={model} showLabel={false} size={10} style={{ opacity: 0.8 }} />,
        icon: (
          <Avatar src={getModelLogo(model.id)} size={20}>
            {first(model.name)}
          </Avatar>
        ),
        filterText: getFancyProviderName(provider) + model.name,
        action: () => {
          hasModelActionRef.current = true
          onMentionModel(model)
        },
        isSelected: mentionedModels.some((selected) => getModelUniqId(selected) === getModelUniqId(model))
      }))

      if (providerItems.length > 0) {
        items.push(...providerItems)
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
      alwaysVisible: true,
      isSelected: false,
      action: ({ context }) => {
        onClearMentionModels()

        if (triggerInfoRef.current?.type === 'input') {
          setText((currentText) => {
            const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null
            const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length
            return removeAtSymbolAndText(currentText, caret, undefined, triggerInfoRef.current?.position)
          })
        }

        context.close()
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
    onClearMentionModels,
    setText,
    removeAtSymbolAndText
  ])

  const openQuickPanel = useCallback(
    (triggerInfo?: MentionTriggerInfo) => {
      hasModelActionRef.current = false
      triggerInfoRef.current = triggerInfo

      quickPanelHook.open({
        title: t('agents.edit.model.select.title'),
        list: modelItems,
        symbol: QuickPanelReservedSymbol.MentionModels,
        multiple: true,
        triggerInfo: triggerInfo || { type: 'button' },
        afterAction({ item }) {
          item.isSelected = !item.isSelected
        },
        onClose({ action, searchText, context }) {
          if (action === 'esc') {
            if (
              hasModelActionRef.current &&
              context.triggerInfo?.type === 'input' &&
              context.triggerInfo?.position !== undefined
            ) {
              setText((currentText) => {
                const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null
                const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length
                return removeAtSymbolAndText(currentText, caret, searchText || '', context.triggerInfo?.position!)
              })
            }
          }
        }
      })
    },
    [modelItems, quickPanelHook, t, setText, removeAtSymbolAndText]
  )

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanelHook.isVisible && quickPanelHook.symbol === QuickPanelReservedSymbol.MentionModels) {
      quickPanelHook.close()
    } else {
      openQuickPanel({ type: 'button' })
    }
  }, [openQuickPanel, quickPanelHook])

  useEffect(() => {
    if (filesRef.current !== files) {
      if (quickPanelHook.isVisible && quickPanelHook.symbol === QuickPanelReservedSymbol.MentionModels) {
        quickPanelHook.close()
      }
      filesRef.current = files
    }
  }, [files, quickPanelHook])

  useEffect(() => {
    if (quickPanelHook.isVisible && quickPanelHook.symbol === QuickPanelReservedSymbol.MentionModels) {
      quickPanelHook.updateList(modelItems)
    }
  }, [mentionedModels, quickPanelHook, modelItems])

  useEffect(() => {
    const disposeRootMenu = quickPanel.registerRootMenu([
      {
        label: t('agents.edit.model.select.title'),
        description: '',
        icon: <AtSign />,
        isMenu: true,
        action: () => openQuickPanel({ type: 'button' })
      }
    ])

    const disposeTrigger = quickPanel.registerTrigger(QuickPanelReservedSymbol.MentionModels, (payload) => {
      const trigger = (payload || {}) as MentionTriggerInfo
      openQuickPanel(trigger)
    })

    return () => {
      disposeRootMenu()
      disposeTrigger()
    }
  }, [openQuickPanel, quickPanel, t])

  return (
    <Tooltip placement="top" title={t('agents.edit.model.select.title')} mouseLeaveDelay={0} arrow>
      <ActionIconButton onClick={handleOpenQuickPanel} active={mentionedModels.length > 0}>
        <AtSign size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

const ProviderName = styled.span`
  font-weight: 500;
`

export default memo(MentionModelsButton)
