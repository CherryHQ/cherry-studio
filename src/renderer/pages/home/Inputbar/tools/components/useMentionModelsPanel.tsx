import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import type { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import { getModelLogo, isEmbeddingModel, isRerankModel, isVisionModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useAssistantsApi } from '@renderer/hooks/useAssistant'
import { useModels } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import type { ToolQuickPanelApi, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import type { Assistant, FileMetadata } from '@renderer/types'
import { FILE_TYPE } from '@renderer/types'
import type { Model } from '@shared/data/types/model'
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
  mentionedAssistant: Assistant | null
  setMentionedAssistant: React.Dispatch<React.SetStateAction<Assistant | null>>
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
    setMentionedAssistant,
    couldMentionNotVisionModel,
    files,
    setText
  } = params
  const { registerRootMenu, registerTrigger } = quickPanel
  const { open, close, updateList, isVisible, symbol } = quickPanelController
  const { providers } = useProviders()
  const { models: v2Models } = useModels()
  const { assistants } = useAssistantsApi()
  const modelsByProvider = useMemo(() => {
    const map = new Map<string, Model[]>()
    for (const m of v2Models) {
      const arr = map.get(m.providerId) ?? []
      arr.push(m)
      map.set(m.providerId, arr)
    }
    return map
  }, [v2Models])
  const { t } = useTranslation()
  const navigate = useNavigate()

  const hasModelActionRef = useRef(false)
  const triggerInfoRef = useRef<MentionTriggerInfo | undefined>(undefined)
  const filesRef = useRef(files)
  const currentSearchRef = useRef('')

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
          const exists = prev.some((m) => m.id === model.id)
          if (exists) return prev.filter((m) => m.id !== model.id)
          return [...prev, model]
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

  const validAssistants = useMemo(() => assistants.filter((a) => a.id && a.name && a.name.trim() !== ''), [assistants])

  const buildModelItems = useCallback(
    (searchText: string): QuickPanelListItem[] => {
      const lower = searchText.toLowerCase()
      const items: QuickPanelListItem[] = []

      if (pinnedModels.length > 0) {
        const pinnedItems = providers.flatMap((provider) =>
          (modelsByProvider.get(provider.id) ?? [])
            .filter((model) => !isEmbeddingModel(model) && !isRerankModel(model))
            .filter((model) => pinnedModels.includes(model.id))
            .filter((model) => couldMentionNotVisionModel || isVisionModel(model))
            .filter((model) => !lower || (getProviderDisplayName(provider) + model.name).toLowerCase().includes(lower))
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
              isSelected: mentionedModels.some((selected) => selected.id === model.id)
            }))
        )
        if (pinnedItems.length > 0) items.push(...sortBy(pinnedItems, ['label']))
      }

      providers.forEach((provider) => {
        const providerModels = sortBy(
          (modelsByProvider.get(provider.id) ?? [])
            .filter((model) => !isEmbeddingModel(model) && !isRerankModel(model))
            .filter((model) => !pinnedModels.includes(model.id))
            .filter((model) => couldMentionNotVisionModel || isVisionModel(model))
            .filter((model) => !lower || (getProviderDisplayName(provider) + model.name).toLowerCase().includes(lower)),
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
          isSelected: mentionedModels.some((selected) => selected.id === model.id)
        }))
        if (providerItems.length > 0) items.push(...providerItems)
      })

      return items
    },
    [couldMentionNotVisionModel, mentionedModels, onMentionModel, pinnedModels, providers, modelsByProvider]
  )

  const buildSectionedList = useCallback(
    (searchText: string): QuickPanelListItem[] => {
      const lower = searchText.toLowerCase()

      const filteredAssistants = lower
        ? validAssistants.filter((a) => a.name.toLowerCase().includes(lower))
        : validAssistants

      const modelItems = buildModelItems(searchText)

      const result: QuickPanelListItem[] = []

      // "Clear" always-visible item
      result.push({
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

      // Assistants section
      if (filteredAssistants.length > 0) {
        result.push({
          label: (
            <span className="pointer-events-none text-[11px] font-semibold uppercase tracking-[0.05em] opacity-50">
              {t('chat.input.mention_assistant.section_label')}
            </span>
          ),
          icon: null,
          filterText: '',
          disabled: true,
          action: () => {}
        })
        for (const a of filteredAssistants) {
          result.push({
            label: (
              <span>
                {a.emoji ? <span style={{ marginRight: 4 }}>{a.emoji}</span> : null}
                {a.name}
              </span>
            ),
            icon: <span style={{ fontSize: 16 }}>{a.emoji || '🤖'}</span>,
            filterText: a.name,
            isSelected: false,
            action: ({ context }) => {
              setMentionedAssistant(a)
              hasModelActionRef.current = true
              if (triggerInfoRef.current?.type === 'input') {
                setText((currentText) => {
                  const textArea = document.querySelector<HTMLTextAreaElement>('.inputbar textarea')
                  const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length
                  return removeAtSymbolAndText(
                    currentText,
                    caret,
                    currentSearchRef.current || '',
                    triggerInfoRef.current?.position
                  )
                })
              }
              context.close()
            }
          })
        }
      }

      // Models section
      if (modelItems.length > 0) {
        result.push({
          label: (
            <span className="pointer-events-none text-[11px] font-semibold uppercase tracking-[0.05em] opacity-50">
              {t('chat.input.mention_assistant.section_models_label')}
            </span>
          ),
          icon: null,
          filterText: '',
          disabled: true,
          action: () => {}
        })
        result.push(...modelItems)
      }

      // "Add model" footer (only show when no search or model section visible)
      if (modelItems.length > 0 || !lower) {
        result.push({
          label: t('settings.models.add.add_model') + '...',
          icon: <Plus />,
          action: () => navigate({ to: '/settings/provider' }),
          isSelected: false
        })
      }

      return result
    },
    [
      validAssistants,
      buildModelItems,
      onClearMentionModels,
      setMentionedAssistant,
      removeAtSymbolAndText,
      setText,
      navigate,
      t
    ]
  )

  const openQuickPanel = useCallback(
    (triggerInfo?: MentionTriggerInfo) => {
      hasModelActionRef.current = false
      triggerInfoRef.current = triggerInfo
      currentSearchRef.current = ''

      open({
        title: t('assistants.presets.edit.model.select.title'),
        list: buildSectionedList(''),
        symbol: QuickPanelReservedSymbol.MentionModels,
        multiple: true,
        manageListExternally: true,
        triggerInfo: triggerInfo || { type: 'button' },
        onSearchChange: (searchText) => {
          currentSearchRef.current = searchText
          updateList(buildSectionedList(searchText))
        },
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
          currentSearchRef.current = ''
        }
      })
    },
    [buildSectionedList, open, updateList, removeAtSymbolAndText, setText, t]
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
      updateList(buildSectionedList(currentSearchRef.current))
    }
  }, [isVisible, buildSectionedList, role, symbol, updateList])

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
