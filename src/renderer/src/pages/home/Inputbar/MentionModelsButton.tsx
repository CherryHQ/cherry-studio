import { loggerService } from '@logger'
import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { QuickPanelListItem } from '@renderer/components/QuickPanel/types'
import { getModelLogo, isEmbeddingModel, isRerankModel, isVisionModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { FileType, Model } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { generateGroupId, validateGroupName } from '@renderer/utils/groupHelpers'
import { removeAtSymbolAndText } from '@renderer/utils/textHelpers'
import { Avatar, Input, Tooltip } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { first, sortBy } from 'lodash'
import { AtSign, CircleX, Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { FC, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import styled from 'styled-components'

const logger = loggerService.withContext('MentionModelsButton')

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

  // --- Model Groups ---
  interface MentionModelGroup {
    id: string
    name: string
    modelIds: string[]
    pinned?: boolean
  }

  const modelGroups = useLiveQuery(
    async () => {
      try {
        const setting = await db.settings.get('mention:modelGroups')
        return (setting?.value || []) as MentionModelGroup[]
      } catch (error) {
        logger.error('Failed to load model groups:', error as any)
        window.toast?.error?.(t('mention_group.load_failed') || 'Failed to load model groups')
        return [] as MentionModelGroup[]
      }
    },
    [],
    [] as MentionModelGroup[]
  )

  // Placeholder: buildModelItems is declared later after dependencies

  const saveGroups = useCallback(
    async (groups: MentionModelGroup[]) => {
      try {
        await db.settings.put({ id: 'mention:modelGroups', value: groups })
      } catch (error) {
        logger.error('Failed to save model groups:', error as any)
        window.toast?.error?.(t('mention_group.save_failed') || 'Failed to save model groups')
        throw error
      }
    },
    [t]
  )

  // Map uniqId -> Model for group reverse lookup
  const uniqIdToModelMap = useMemo(() => {
    const map = new Map<string, Model>()
    providers.forEach((p) => {
      p.models.forEach((m) => {
        if (!isEmbeddingModel(m) && !isRerankModel(m)) {
          map.set(getModelUniqId(m), m)
        }
      })
    })
    return map
  }, [providers])

  const mentionedSet = useMemo(() => new Set(mentionedModels.map((m) => getModelUniqId(m))), [mentionedModels])

  // Keep latest selection and groups to avoid stale closures
  const mentionedModelsRef = useRef<Model[]>(mentionedModels)
  useEffect(() => {
    mentionedModelsRef.current = mentionedModels
  }, [mentionedModels])

  const modelGroupsRef = useRef<MentionModelGroup[]>(modelGroups || [])
  useEffect(() => {
    modelGroupsRef.current = (modelGroups || []) as MentionModelGroup[]
  }, [modelGroups])

  const toggleGroupSelection = useCallback(
    (group: MentionModelGroup) => {
      // Determine whether the whole group is selected
      const allSelected = group.modelIds.every((id) => mentionedSet.has(id))

      // Map group members to model objects
      const rawModels = group.modelIds.map((id) => uniqIdToModelMap.get(id)).filter((m): m is Model => !!m)

      // When constrained (e.g. images), keep only vision-capable models
      const targetModels = couldMentionNotVisionModel ? rawModels : rawModels.filter((m) => isVisionModel(m))
      const skipped = rawModels.length - targetModels.length

      if (targetModels.length === 0) {
        // If none are usable, show a gentle warning
        if (skipped > 0) {
          window.toast?.warning?.(t('mention_group.no_usable_models_warning'))
        }
        return
      }

      hasModelActionRef.current = true
      targetModels.forEach((m) => {
        const id = getModelUniqId(m)
        const isSelected = mentionedSet.has(id)
        // Toggle selection consistently with single-item behavior
        if ((allSelected && isSelected) || (!allSelected && !isSelected)) {
          onMentionModel(m)
        }
      })

      // If some were filtered (e.g. non-vision models), show a hint
      if (skipped > 0) {
        window.toast?.info?.(t('mention_group.skipped_info', { count: skipped } as any) as string)
      }
    },
    [mentionedSet, onMentionModel, uniqIdToModelMap, couldMentionNotVisionModel, t]
  )

  const modalOpenRef = useRef(false)

  const deleteGroup = useCallback(
    async (group: MentionModelGroup) => {
      let confirmed = false
      await new Promise<void>((resolve) => {
        window.modal.confirm({
          centered: true,
          title: t('mention_group.delete_confirm_title'),
          content: t('mention_group.delete_confirm_content'),
          onOk: () => {
            confirmed = true
            resolve()
          },
          onCancel: () => resolve()
        })
      })
      if (!confirmed) return

      try {
        const groups = (modelGroups || []).filter((g) => g.id !== group.id)
        await saveGroups(groups)
        window.toast?.success?.(t('mention_group.deleted'))
      } catch {
        // handled in saveGroups
      }
    },
    [modelGroups, saveGroups, t]
  )

  const renameGroup = useCallback(
    async (group: MentionModelGroup) => {
      if (modalOpenRef.current) return
      modalOpenRef.current = true
      let tempName = group.name
      await new Promise<void>((resolve) => {
        window.modal.confirm({
          centered: true,
          title: t('mention_group.rename_group'),
          content: (
            <div>
              <div style={{ marginBottom: 8 }}>{t('mention_group.group_name')}</div>
              <Input
                autoFocus
                defaultValue={group.name}
                onChange={(e) => (tempName = e.target.value)}
                placeholder={t('mention_group.group_name') as string}
              />
            </div>
          ),
          onOk: () => resolve(),
          onCancel: () => resolve()
        })
      })
      modalOpenRef.current = false

      const name = (tempName || '').trim()
      if (!name || name === group.name) return
      if (!validateGroupName(name)) {
        window.toast?.warning?.(t('mention_group.invalid_name') || 'Invalid group name')
        return
      }

      const groups = (modelGroups || []) as MentionModelGroup[]
      const exist = groups.find((g) => g.name === name)
      if (exist && exist.id !== group.id) {
        window.toast?.warning?.(t('mention_group.name_exists') || 'Name already exists')
        return
      }

      const target = groups.find((g) => g.id === group.id)
      if (!target) return
      target.name = name
      try {
        await saveGroups([...groups])
        window.toast?.success?.(t('mention_group.saved'))
      } catch {
        // handled in saveGroups
      }
    },
    [modelGroups, saveGroups, t]
  )

  // buildModelItems moved below dependencies

  // No pin/unpin group feature for now

  const saveSelectionAsGroup = useCallback(async () => {
    const selected = mentionedModelsRef.current || []
    if (selected.length === 0) {
      window.toast?.warning?.(t('mention_group.no_selection_warning'))
      return
    }

    let tempName = ''
    if (modalOpenRef.current) return
    modalOpenRef.current = true
    await new Promise<void>((resolve) => {
      window.modal.confirm({
        centered: true,
        title: `${t('agents.edit.model.select.title')} - ${t('mention_group.save_as_group')}`,
        content: (
          <div>
            <div style={{ marginBottom: 8 }}>{t('mention_group.group_name')}</div>
            <Input
              autoFocus
              onChange={(e) => (tempName = e.target.value)}
              placeholder={t('mention_group.group_name') as string}
            />
          </div>
        ),
        onOk: () => resolve(),
        onCancel: () => resolve()
      })
    })
    modalOpenRef.current = false

    const name = (tempName || '').trim()
    if (!name) return
    if (!validateGroupName(name)) {
      window.toast?.warning?.(t('mention_group.invalid_name') || 'Invalid group name')
      return
    }

    const modelIds = selected.map((m) => getModelUniqId(m))
    const groups = (modelGroupsRef.current || []) as MentionModelGroup[]
    const exist = groups.find((g) => g.name === name)
    if (exist) {
      // Overwrite the group with the same name
      exist.modelIds = modelIds
      try {
        await saveGroups([...groups])
      } catch {
        // handled in saveGroups
      }
    } else {
      const id = generateGroupId()
      try {
        await saveGroups([...groups, { id, name, modelIds }])
      } catch {
        // handled in saveGroups
      }
    }
    window.toast?.success?.(t('mention_group.saved'))
  }, [saveGroups, t])

  // Track if selection actions happen and keep trigger info for cleanup
  const hasModelActionRef = useRef<boolean>(false)
  const triggerInfoRef = useRef<{ type: 'input' | 'button'; position?: number; originalText?: string } | undefined>(
    undefined
  )

  const pinnedModels = useLiveQuery(
    async () => {
      try {
        const setting = await db.settings.get('pinned:models')
        return setting?.value || []
      } catch (error) {
        logger.error('Failed to load pinned models:', error as any)
        return []
      }
    },
    [],
    []
  )

  // Build QuickPanel items from a groups snapshot (declared after dependencies)
  const buildModelItems = useCallback(
    (groupsSnapshot: MentionModelGroup[]): QuickPanelListItem[] => {
      const items: QuickPanelListItem[] = []

      // Group items (top section, after the clear action)
      if ((groupsSnapshot || []).length > 0) {
        const sortedGroups = [...groupsSnapshot].sort((a, b) => a.name.localeCompare(b.name))
        const groupItems: QuickPanelListItem[] = sortedGroups.map((g) => {
          // Filter allowed models by current constraints (vision-only when images present)
          const allowedModels = g.modelIds
            .map((id) => uniqIdToModelMap.get(id))
            .filter((m): m is Model => !!m && (couldMentionNotVisionModel || isVisionModel(m)))

          const groupModelNames = allowedModels
            .map((m) => m.name)
            .filter(Boolean)
            .join(', ')

          const allowedIds = allowedModels.map((m) => getModelUniqId(m))
          const isSelected = allowedIds.length > 0 && allowedIds.every((id) => mentionedSet.has(id))

          return {
            label: (
              <>
                <span style={{ fontWeight: 500 }}>{g.name}</span>
                <span style={{ opacity: 0.65 }}> ({allowedModels.length})</span>
              </>
            ),
            description: groupModelNames,
            icon: <Layers size={18} />,
            filterText: `${g.name} ${groupModelNames}`,
            isSelected,
            disabled: allowedModels.length === 0,
            action: () => toggleGroupSelection(g),
            suffix: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--color-text-3)' }}>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    renameGroup(g)
                  }}
                  title={t('mention_group.rename_group') as string}
                  style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <Pencil size={16} />
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteGroup(g)
                  }}
                  title={t('mention_group.delete_group') as string}
                  style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <Trash2 size={16} />
                </span>
              </span>
            )
          }
        })

        items.push(...groupItems)
      }

      // Pinned models
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
                hasModelActionRef.current = true // mark action
                onMentionModel(m)
              },
              isSelected: mentionedSet.has(getModelUniqId(m))
            }))
        )

        if (pinnedItems.length > 0) {
          items.push(...sortBy(pinnedItems, ['label']))
        }
      }

      // Regular models
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
            hasModelActionRef.current = true // mark action
            onMentionModel(m)
          },
          isSelected: mentionedSet.has(getModelUniqId(m))
        }))

        if (providerModelItems.length > 0) {
          items.push(...providerModelItems)
        }
      })

      // Add/save items
      items.push({
        label: t('settings.models.add.add_model') + '...',
        icon: <Plus />,
        action: () => navigate('/settings/provider'),
        isSelected: false
      })

      items.push({
        label: (t('mention_group.save_as_group') as string) + '...',
        description: mentionedModels.length > 0 ? `${mentionedModels.length} models` : undefined,
        icon: <Layers />,
        action: () => saveSelectionAsGroup()
      })

      // Put clear action at the top
      items.unshift({
        label: t('settings.input.clear.all'),
        description: t('settings.input.clear.models'),
        icon: <CircleX />,
        alwaysVisible: true,
        isSelected: false,
        action: () => {
          onClearMentionModels()

          if (triggerInfoRef.current?.type === 'input') {
            setText((currentText) => {
              const caret = triggerInfoRef.current?.position ?? currentText.length
              return removeAtSymbolAndText(currentText, caret, undefined, triggerInfoRef.current?.position)
            })
          }

          quickPanel.close()
        }
      })

      return items
    },
    [
      providers,
      t,
      couldMentionNotVisionModel,

      onMentionModel,
      navigate,
      quickPanel,
      onClearMentionModels,
      setText,
      uniqIdToModelMap,
      mentionedSet,
      mentionedModels.length,
      toggleGroupSelection,
      saveSelectionAsGroup,
      pinnedModels,
      renameGroup,
      deleteGroup
    ]
  )

  const modelItems = useMemo(
    () => buildModelItems((modelGroups || []) as MentionModelGroup[]),
    [buildModelItems, modelGroups]
  )

  const openQuickPanel = useCallback(
    (triggerInfo?: { type: 'input' | 'button'; position?: number; originalText?: string }) => {
      // Reset model-action flag
      hasModelActionRef.current = false
      // Save trigger info
      triggerInfoRef.current = triggerInfo

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
          // ESC close: delete '@' and the search text
          if (action === 'esc') {
            // Only do this for input trigger and when a selection occurred
            if (
              hasModelActionRef.current &&
              closeTriggerInfo?.type === 'input' &&
              closeTriggerInfo?.position !== undefined
            ) {
              // Use saved position to avoid DOM queries
              setText((currentText) => {
                const caret = closeTriggerInfo.position!
                return removeAtSymbolAndText(currentText, caret, searchText || '', closeTriggerInfo.position!)
              })
            }
          }
          // Backspace deletion of '@': already removed naturally; nothing else to do
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
    // Close the panel if files changed
    if (filesRef.current !== files) {
      if (quickPanel.isVisible && quickPanel.symbol === '@') {
        quickPanel.close()
      }
      filesRef.current = files
    }
  }, [files, quickPanel])

  // Cleanup lingering refs on unmount
  useEffect(() => {
    return () => {
      triggerInfoRef.current = undefined
      hasModelActionRef.current = false
      modalOpenRef.current = false
    }
  }, [])

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
