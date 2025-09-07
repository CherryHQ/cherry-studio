import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { QuickPanelListItem } from '@renderer/components/QuickPanel/types'
import { getModelLogo, isEmbeddingModel, isRerankModel, isVisionModel } from '@renderer/config/models'
import db from '@renderer/databases'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { FileType, Model } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { Avatar, Input, Tooltip } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { first, sortBy } from 'lodash'
import { AtSign, CircleX, Layers, Plus, Trash2, Pencil } from 'lucide-react'
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

  // --- Model Groups ---
  type MentionModelGroup = { id: string; name: string; modelIds: string[]; pinned?: boolean }

  const modelGroups = useLiveQuery(
    async () => {
      const setting = await db.settings.get('mention:modelGroups')
      return (setting?.value || []) as MentionModelGroup[]
    },
    [],
    [] as MentionModelGroup[]
  )

  // 占位：buildModelItems 在下方依赖项定义后声明

  const saveGroups = useCallback(async (groups: MentionModelGroup[]) => {
    await db.settings.put({ id: 'mention:modelGroups', value: groups })
  }, [])

  // 映射 uniqId -> Model，便于通过分组反查模型对象
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

  // 始终获取最新的选择和分组，避免 QuickPanel 打开后闭包捕获旧值
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
      // 判断该组是否“全选中”
      const allSelected = group.modelIds.every((id) => mentionedSet.has(id))

      // 映射分组成员 → 模型对象
      const rawModels = group.modelIds
        .map((id) => uniqIdToModelMap.get(id))
        .filter((m): m is Model => !!m)

      // 受限时仅保留视觉模型，避免点击分组时“无反馈”
      const targetModels = couldMentionNotVisionModel ? rawModels : rawModels.filter((m) => isVisionModel(m))
      const skipped = rawModels.length - targetModels.length

      if (targetModels.length === 0) {
        // 若全部不可用，给出轻提示
        if (skipped > 0) {
          window.message?.warning?.(t('mention_group.no_usable_models_warning'))
        }
        return
      }

      hasModelActionRef.current = true
      targetModels.forEach((m) => {
        const id = getModelUniqId(m)
        const isSelected = mentionedSet.has(id)
        // 执行与单项相同的切换逻辑
        if ((allSelected && isSelected) || (!allSelected && !isSelected)) {
          onMentionModel(m)
        }
      })

      // 若有部分被过滤，提示原因（如含图片时非视觉模型被跳过）
      if (skipped > 0) {
        window.message?.info?.(t('mention_group.skipped_info', { count: skipped } as any) as string)
      }
    },
    [mentionedSet, onMentionModel, uniqIdToModelMap, couldMentionNotVisionModel, t]
  )

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

      const groups = (modelGroups || []).filter((g) => g.id !== group.id)
      await saveGroups(groups)
      window.message?.success?.(t('mention_group.deleted'))
    },
    [modelGroups, saveGroups, t]
  )

  const renameGroup = useCallback(
    async (group: MentionModelGroup) => {
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

      const name = (tempName || '').trim()
      if (!name || name === group.name) return

      const groups = (modelGroups || []) as MentionModelGroup[]
      const exist = groups.find((g) => g.name === name)
      if (exist && exist.id !== group.id) {
        window.message?.warning?.(t('mention_group.name_exists') || 'Name already exists')
        return
      }

      const target = groups.find((g) => g.id === group.id)
      if (!target) return
      target.name = name
      await saveGroups([...groups])
      window.message?.success?.(t('mention_group.saved'))
    },
    [modelGroups, saveGroups, t]
  )

  // buildModelItems moved below dependencies

  // 移除分组置顶功能

  const saveSelectionAsGroup = useCallback(async () => {
    const selected = mentionedModelsRef.current || []
    if (selected.length === 0) {
      window.message?.warning?.(t('mention_group.no_selection_warning'))
      return
    }

    let tempName = ''
    await new Promise<void>((resolve) => {
      window.modal.confirm({
        centered: true,
        title: `${t('agents.edit.model.select.title')} - ${t('mention_group.save_as_group')}`,
        content: (
          <div>
            <div style={{ marginBottom: 8 }}>{t('mention_group.group_name')}</div>
            <Input autoFocus onChange={(e) => (tempName = e.target.value)} placeholder={t('mention_group.group_name') as string} />
          </div>
        ),
        onOk: () => resolve(),
        onCancel: () => resolve()
      })
    })

    const name = (tempName || '').trim()
    if (!name) return

    const modelIds = selected.map((m) => getModelUniqId(m))
    const groups = (modelGroupsRef.current || []) as MentionModelGroup[]
    const exist = groups.find((g) => g.name === name)
    if (exist) {
      // 覆盖同名分组
      exist.modelIds = modelIds
      await saveGroups([...groups])
    } else {
      const id = (globalThis.crypto && 'randomUUID' in globalThis.crypto
        ? (globalThis.crypto as Crypto).randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2)}`)
      await saveGroups([...groups, { id, name, modelIds }])
    }
    window.message?.success?.(t('mention_group.saved'))
  }, [saveGroups, t])

  // 记录是否有模型被选择的动作发生
  const hasModelActionRef = useRef<boolean>(false)
  // 记录触发信息，用于清除操作
  const triggerInfoRef = useRef<{ type: 'input' | 'button'; position?: number; originalText?: string } | undefined>(
    undefined
  )

  // 基于光标 + 搜索词定位并删除最近一次触发的 @ 及搜索文本
  const removeAtSymbolAndText = useCallback(
    (currentText: string, caretPosition: number, searchText?: string, fallbackPosition?: number) => {
      const safeCaret = Math.max(0, Math.min(caretPosition ?? 0, currentText.length))

      // ESC/精确删除：优先按 pattern = "@" + searchText 从光标向左最近匹配
      if (searchText !== undefined) {
        const pattern = '@' + searchText
        const fromIndex = Math.max(0, safeCaret - 1)
        const start = currentText.lastIndexOf(pattern, fromIndex)
        if (start !== -1) {
          const end = start + pattern.length
          return currentText.slice(0, start) + currentText.slice(end)
        }

        // 兜底：使用打开时的 position 做校验后再删
        if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === '@') {
          const expected = pattern
          const actual = currentText.slice(fallbackPosition, fallbackPosition + expected.length)
          if (actual === expected) {
            return currentText.slice(0, fallbackPosition) + currentText.slice(fallbackPosition + expected.length)
          }
          // 如果不完全匹配，安全起见仅删除单个 '@'
          return currentText.slice(0, fallbackPosition) + currentText.slice(fallbackPosition + 1)
        }

        // 未找到匹配则不改动
        return currentText
      }

      // 清除按钮：未知搜索词，删除离光标最近的 '@' 及后续连续非空白（到空格/换行/结尾）
      {
        const fromIndex = Math.max(0, safeCaret - 1)
        const start = currentText.lastIndexOf('@', fromIndex)
        if (start === -1) {
          // 兜底：使用打开时的 position（若存在），按空白边界删除
          if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === '@') {
            let endPos = fallbackPosition + 1
            while (endPos < currentText.length && currentText[endPos] !== ' ' && currentText[endPos] !== '\n') {
              endPos++
            }
            return currentText.slice(0, fallbackPosition) + currentText.slice(endPos)
          }
          return currentText
        }

        let endPos = start + 1
        while (endPos < currentText.length && currentText[endPos] !== ' ' && currentText[endPos] !== '\n') {
          endPos++
        }
        return currentText.slice(0, start) + currentText.slice(endPos)
      }
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

  // 基于给定的分组快照构建 QuickPanel 列表（放在依赖声明之后，避免TS的声明顺序问题）
  const buildModelItems = useCallback(
    (groupsSnapshot: MentionModelGroup[]): QuickPanelListItem[] => {
      const items: QuickPanelListItem[] = []

      // 分组项（显示在顶部，紧随“清除”之后）
      if ((groupsSnapshot || []).length > 0) {
        const sortedGroups = [...groupsSnapshot].sort((a, b) => a.name.localeCompare(b.name))
        const groupItems: QuickPanelListItem[] = sortedGroups.map((g) => {
          // 按当前约束过滤出可用模型（有图片时仅视觉模型）
          const allowedModels = g.modelIds
            .map((id) => uniqIdToModelMap.get(id))
            .filter((m): m is Model => !!m && (couldMentionNotVisionModel || isVisionModel(m)))

          const groupModelNames = allowedModels.map((m) => m.name).filter(Boolean).join(', ')

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

      // 置顶模型
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

      // 常规模型
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

      // 添加/保存项
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

      // 清除项放到顶部
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
              const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null
              const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length
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
      mentionedModels,
      onMentionModel,
      navigate,
      quickPanel,
      onClearMentionModels,
      setText,
      removeAtSymbolAndText,
      uniqIdToModelMap,
      mentionedSet,
      toggleGroupSelection,
      saveSelectionAsGroup,
      pinnedModels,
      renameGroup,
      deleteGroup
    ]
  )

  const modelItems = useMemo(() => buildModelItems((modelGroups || []) as MentionModelGroup[]), [buildModelItems, modelGroups])

  const openQuickPanel = useCallback(
    (triggerInfo?: { type: 'input' | 'button'; position?: number; originalText?: string }) => {
      // 重置模型动作标记
      hasModelActionRef.current = false
      // 保存触发信息
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
          // ESC关闭时的处理：删除 @ 和搜索文本
          if (action === 'esc') {
            // 只有在输入触发且有模型选择动作时才删除@字符和搜索文本
            if (
              hasModelActionRef.current &&
              closeTriggerInfo?.type === 'input' &&
              closeTriggerInfo?.position !== undefined
            ) {
              // 基于当前光标 + 搜索词精确定位并删除，position 仅作兜底
              setText((currentText) => {
                const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null
                const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length
                return removeAtSymbolAndText(currentText, caret, searchText || '', closeTriggerInfo.position!)
              })
            }
          }
          // Backspace删除@的情况（delete-symbol）：
          // @ 已经被Backspace自然删除，面板关闭，不需要额外操作
        }
      })
    },
    [modelItems, quickPanel, t, setText, removeAtSymbolAndText]
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
