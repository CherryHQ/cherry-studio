import { ActionIconButton } from '@renderer/components/Buttons'
import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import { type QuickPanelListItem, QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
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
  setText: React.Dispatch<React.SetStateAction<string>>
}

const MentionModelsButton: FC<Props> = ({
  ref,
  mentionedModels,
  onMentionModel,
  onClearMentionModels,
  couldMentionNotVisionModel,
  files,
  setText
}) => {
  const { providers } = useProviders()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const quickPanel = useQuickPanel()

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
      alwaysVisible: true,
      isSelected: false,
      action: ({ context: ctx }) => {
        onClearMentionModels()

        // 只有输入触发时才需要删除 @ 与搜索文本（未知搜索词，按光标就近删除）
        if (triggerInfoRef.current?.type === 'input') {
          setText((currentText) => {
            const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null
            const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length
            return removeAtSymbolAndText(currentText, caret, undefined, triggerInfoRef.current?.position)
          })
        }

        ctx.close()
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
    (triggerInfo?: { type: 'input' | 'button'; position?: number; originalText?: string }) => {
      // 重置模型动作标记
      hasModelActionRef.current = false
      // 保存触发信息
      triggerInfoRef.current = triggerInfo

      quickPanel.open({
        title: t('agents.edit.model.select.title'),
        list: modelItems,
        symbol: QuickPanelReservedSymbol.MentionModels,
        multiple: true,
        triggerInfo: triggerInfo || { type: 'button' },
        afterAction({ item }) {
          item.isSelected = !item.isSelected
        },
        onClose({ action, searchText, context: ctx }) {
          // ESC关闭时的处理：删除 @ 和搜索文本
          if (action === 'esc') {
            // 只有在输入触发且有模型选择动作时才删除@字符和搜索文本
            if (
              hasModelActionRef.current &&
              ctx.triggerInfo?.type === 'input' &&
              ctx.triggerInfo?.position !== undefined
            ) {
              // 基于当前光标 + 搜索词精确定位并删除，position 仅作兜底
              setText((currentText) => {
                const textArea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null
                const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length
                return removeAtSymbolAndText(currentText, caret, searchText || '', ctx.triggerInfo?.position!)
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
    if (quickPanel.isVisible && quickPanel.symbol === QuickPanelReservedSymbol.MentionModels) {
      quickPanel.close()
    } else {
      openQuickPanel({ type: 'button' })
    }
  }, [openQuickPanel, quickPanel])

  const filesRef = useRef(files)

  useEffect(() => {
    // 检查files是否变化
    if (filesRef.current !== files) {
      if (quickPanel.isVisible && quickPanel.symbol === QuickPanelReservedSymbol.MentionModels) {
        quickPanel.close()
      }
      filesRef.current = files
    }
  }, [files, quickPanel])

  // 监听 mentionedModels 变化，动态更新已打开的 QuickPanel 列表状态
  useEffect(() => {
    if (quickPanel.isVisible && quickPanel.symbol === QuickPanelReservedSymbol.MentionModels) {
      // 直接使用重新计算的 modelItems，因为它已经包含了最新的 isSelected 状态
      quickPanel.updateList(modelItems)
    }
  }, [mentionedModels, quickPanel, modelItems])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

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
