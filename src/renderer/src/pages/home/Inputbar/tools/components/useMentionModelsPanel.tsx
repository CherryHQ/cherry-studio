import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import type { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import { getModelLogo, isEmbeddingModel, isRerankModel, isVisionModel } from '@renderer/config/models'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import db from '@renderer/databases'
import { useModels } from '@renderer/hooks/useModels'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProviders'
import type { ToolQuickPanelApi, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import type { FileMetadata, Model } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import { createUniqueModelId } from '@shared/data/types/model'
import { useNavigate } from '@tanstack/react-router'
import { Avatar } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { first, sortBy } from 'lodash'
import { AtSign, CircleX, Plus } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export type MentionTriggerInfo = { type: 'input' | 'button'; position?: number; originalText?: string }

interface Params {
  quickPanel: ToolQuickPanelApi
  quickPanelController: ToolQuickPanelController
  mentionedModels: Model[]
  setMentionedModels: React.Dispatch<React.SetStateAction<Model[]>>
  couldMentionNotVisionModel: boolean
  files: FileMetadata[]
  setText: React.Dispatch<React.SetStateAction<string>>
}

export const useMentionModelsPanel = (params: Params, role: 'button' | 'manager' = 'button') => {
  const {
    quickPanel,
    quickPanelController,
    mentionedModels,
    setMentionedModels,
    couldMentionNotVisionModel,
    files,
    setText
  } = params
  const { registerRootMenu, registerTrigger } = quickPanel
  const { open, close, updateList, isVisible, symbol } = quickPanelController
  const { providers } = useProviders()
  const { models: v2Models } = useModels()
  const v1ModelsByProvider = useMemo(() => {
    const map = new Map<string, Model[]>()
    for (const m of v2Models) {
      const arr = map.get(m.providerId) ?? []
      arr.push(fromSharedModel(m))
      map.set(m.providerId, arr)
    }
    return map
  }, [v2Models])
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

  const onMentionModel = useCallback(
    (model: Model) => {
      const allowNonVision = !files.some((file) => file.type === FILE_TYPE.IMAGE)
      if (isVisionModel(model) || allowNonVision) {
        setMentionedModels((prev) => {
          const modelId = createUniqueModelId(model.provider, model.id)
          const exists = prev.some((m) => createUniqueModelId(m.provider, m.id) === modelId)
          if (exists) return prev.filter((m) => createUniqueModelId(m.provider, m.id) !== modelId)
          // Normalize id to UniqueModelId (providerId::modelId) for backend consumption
          const normalized = { ...model, id: model.id.includes('::') ? model.id : `${model.provider}::${model.id}` }
          return [...prev, normalized]
        })
        hasModelActionRef.current = true
      }
    },
    [files, setMentionedModels]
  )

  const onClearMentionModels = useCallback(() => {
    setMentionedModels([])
  }, [setMentionedModels])

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
        (v1ModelsByProvider.get(provider.id) ?? [])
          .filter((model) => !isEmbeddingModel(model) && !isRerankModel(model))
          .filter((model) => pinnedModels.includes(createUniqueModelId(model.provider, model.id)))
          .filter((model) => couldMentionNotVisionModel || (!couldMentionNotVisionModel && isVisionModel(model)))
          .map((model) => ({
            label: (
              <>
                <ProviderName>{getProviderDisplayName(provider)}</ProviderName>
                <span style={{ opacity: 0.8 }}> | {model.name}</span>
              </>
            ),
            description: <ModelTagsWithLabel model={model} showLabel={false} size={10} style={{ opacity: 0.8 }} />,
            icon: (() => {
              const Icon = getModelLogo(model)
              return Icon ? <Icon.Avatar size={20} /> : <Avatar size={20}>{first(model.name)}</Avatar>
            })(),
            filterText: getProviderDisplayName(provider) + model.name,
            action: () => onMentionModel(model),
            isSelected: mentionedModels.some(
              (selected) =>
                createUniqueModelId(selected.provider, selected.id) === createUniqueModelId(model.provider, model.id)
            )
          }))
      )

      if (pinnedItems.length > 0) {
        items.push(...sortBy(pinnedItems, ['label']))
      }
    }

    providers.forEach((provider) => {
      const providerModels = sortBy(
        (v1ModelsByProvider.get(provider.id) ?? [])
          .filter((model) => !isEmbeddingModel(model) && !isRerankModel(model))
          .filter((model) => !pinnedModels.includes(createUniqueModelId(model.provider, model.id)))
          .filter((model) => couldMentionNotVisionModel || (!couldMentionNotVisionModel && isVisionModel(model))),
        ['group', 'name']
      )

      const providerItems = providerModels.map((model) => ({
        label: (
          <>
            <ProviderName>{getProviderDisplayName(provider)}</ProviderName>
            <span style={{ opacity: 0.8 }}> | {model.name}</span>
          </>
        ),
        description: <ModelTagsWithLabel model={model} showLabel={false} size={10} style={{ opacity: 0.8 }} />,
        icon: (() => {
          const Icon = getModelLogo(model)
          return Icon ? <Icon.Avatar size={20} /> : <Avatar size={20}>{first(model.name)}</Avatar>
        })(),
        filterText: getProviderDisplayName(provider) + model.name,
        action: () => onMentionModel(model),
        isSelected: mentionedModels.some(
          (selected) =>
            createUniqueModelId(selected.provider, selected.id) === createUniqueModelId(model.provider, model.id)
        )
      }))

      if (providerItems.length > 0) {
        items.push(...providerItems)
      }
    })

    items.push({
      label: t('settings.models.add.add_model') + '...',
      icon: <Plus />,
      action: () => navigate({ to: '/settings/provider' }),
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
            const textArea = document.querySelector<HTMLTextAreaElement>('.inputbar textarea')
            const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length
            return removeAtSymbolAndText(currentText, caret, undefined, triggerInfoRef.current?.position)
          })
        }

        context.close()
      }
    })

    return items
  }, [
    couldMentionNotVisionModel,
    mentionedModels,
    navigate,
    onClearMentionModels,
    onMentionModel,
    pinnedModels,
    providers,
    v1ModelsByProvider,
    removeAtSymbolAndText,
    setText,
    t
  ])

  const openQuickPanel = useCallback(
    (triggerInfo?: MentionTriggerInfo) => {
      hasModelActionRef.current = false
      triggerInfoRef.current = triggerInfo

      open({
        title: t('assistants.presets.edit.model.select.title'),
        list: modelItems,
        symbol: QuickPanelReservedSymbol.MentionModels,
        multiple: true,
        triggerInfo: triggerInfo || { type: 'button' },
        afterAction({ item }) {
          item.isSelected = !item.isSelected
        },
        onClose({ action, searchText, context }) {
          if (action === 'esc') {
            const trigger = context?.triggerInfo ?? triggerInfoRef.current
            if (hasModelActionRef.current && trigger?.type === 'input' && trigger?.position !== undefined) {
              setText((currentText) => {
                const textArea = document.querySelector<HTMLTextAreaElement>('.inputbar textarea')
                const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length
                return removeAtSymbolAndText(currentText, caret, searchText || '', trigger?.position)
              })
            }
          }
          triggerInfoRef.current = undefined
        }
      })
    },
    [modelItems, open, removeAtSymbolAndText, setText, t]
  )

  const handleOpenQuickPanel = useCallback(() => {
    if (isVisible && symbol === QuickPanelReservedSymbol.MentionModels) {
      close()
    } else {
      openQuickPanel({ type: 'button' })
    }
  }, [close, isVisible, openQuickPanel, symbol])

  useEffect(() => {
    if (role !== 'manager') return
    if (filesRef.current !== files) {
      if (isVisible && symbol === QuickPanelReservedSymbol.MentionModels) {
        close()
      }
      filesRef.current = files
    }
  }, [close, files, isVisible, role, symbol])

  useEffect(() => {
    if (role !== 'manager') return
    if (isVisible && symbol === QuickPanelReservedSymbol.MentionModels) {
      updateList(modelItems)
    }
  }, [isVisible, modelItems, role, symbol, updateList])

  useEffect(() => {
    if (role !== 'manager') return
    const disposeRootMenu = registerRootMenu([
      {
        label: t('assistants.presets.edit.model.select.title'),
        description: '',
        icon: <AtSign />,
        isMenu: true,
        action: () => openQuickPanel({ type: 'button' })
      }
    ])

    const disposeTrigger = registerTrigger(QuickPanelReservedSymbol.MentionModels, (payload) => {
      const trigger = (payload || {}) as MentionTriggerInfo
      openQuickPanel(trigger)
    })

    return () => {
      disposeRootMenu()
      disposeTrigger()
    }
  }, [openQuickPanel, registerRootMenu, registerTrigger, role, t])

  return {
    handleOpenQuickPanel,
    openQuickPanel
  }
}

const ProviderName = styled.span`
  font-weight: 500;
`
