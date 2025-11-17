import { Tooltip } from '@cherrystudio/ui'
import { ActionIconButton } from '@renderer/components/Buttons'
import {
  MdiLightbulbAutoOutline,
  MdiLightbulbOffOutline,
  MdiLightbulbOn,
  MdiLightbulbOn30,
  MdiLightbulbOn50,
  MdiLightbulbOn80
} from '@renderer/components/Icons/SVGIcon'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import {
  getThinkModelType,
  isDoubaoThinkingAutoModel,
  isGPT5SeriesReasoningModel,
  isOpenAIWebSearchModel,
  MODEL_SUPPORTED_OPTIONS
} from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { getReasoningEffortOptionsLabel } from '@renderer/i18n/label'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { Model, ThinkingOption } from '@renderer/types'
import type { FC, ReactElement } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  quickPanel: ToolQuickPanelApi
  model: Model
  assistantId: string
}

const ThinkingButton: FC<Props> = ({ quickPanel, model, assistantId }): ReactElement => {
  const { t } = useTranslation()
  const quickPanelHook = useQuickPanel()
  const { assistant, updateAssistantSettings } = useAssistant(assistantId)

  const currentReasoningEffort = useMemo(() => {
    return assistant.settings?.reasoning_effort || 'none'
  }, [assistant.settings?.reasoning_effort])

  // 确定当前模型支持的选项类型
  const modelType = useMemo(() => getThinkModelType(model), [model])

  // 获取当前模型支持的选项
  const supportedOptions: ThinkingOption[] = useMemo(() => {
    if (modelType === 'doubao') {
      if (isDoubaoThinkingAutoModel(model)) {
        return ['none', 'auto', 'high']
      }
      return ['none', 'high']
    }
    return MODEL_SUPPORTED_OPTIONS[modelType]
  }, [model, modelType])

  const onThinkingChange = useCallback(
    (option?: ThinkingOption) => {
      const isEnabled = option !== undefined && option !== 'none'
      // 然后更新设置
      if (!isEnabled) {
        updateAssistantSettings({
          reasoning_effort: option,
          reasoning_effort_cache: option,
          qwenThinkMode: false
        })
        return
      }
      if (
        isOpenAIWebSearchModel(model) &&
        isGPT5SeriesReasoningModel(model) &&
        assistant.enableWebSearch &&
        option === 'minimal'
      ) {
        window.toast.warning(t('chat.web_search.warning.openai'))
        return
      }
      updateAssistantSettings({
        reasoning_effort: option,
        reasoning_effort_cache: option,
        qwenThinkMode: true
      })
      return
    },
    [updateAssistantSettings, assistant.enableWebSearch, model, t]
  )

  const panelItems = useMemo(() => {
    // 使用表中定义的选项创建UI选项
    return supportedOptions.map((option) => ({
      level: option,
      label: getReasoningEffortOptionsLabel(option),
      description: '',
      icon: ThinkingIcon(option),
      isSelected: currentReasoningEffort === option,
      action: () => onThinkingChange(option)
    }))
  }, [currentReasoningEffort, supportedOptions, onThinkingChange])

  const isThinkingEnabled = currentReasoningEffort !== undefined && currentReasoningEffort !== 'none'

  const disableThinking = useCallback(() => {
    onThinkingChange('none')
  }, [onThinkingChange])

  const openQuickPanel = useCallback(() => {
    quickPanelHook.open({
      title: t('assistants.settings.reasoning_effort.label'),
      list: panelItems,
      symbol: QuickPanelReservedSymbol.Thinking
    })
  }, [quickPanelHook, panelItems, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanelHook.isVisible && quickPanelHook.symbol === QuickPanelReservedSymbol.Thinking) {
      quickPanelHook.close()
      return
    }

    if (isThinkingEnabled && supportedOptions.includes('none')) {
      disableThinking()
      return
    }
    openQuickPanel()
  }, [openQuickPanel, quickPanelHook, isThinkingEnabled, supportedOptions, disableThinking])

  useEffect(() => {
    const disposeMenu = quickPanel.registerRootMenu([
      {
        label: t('assistants.settings.reasoning_effort.label'),
        description: '',
        icon: ThinkingIcon(currentReasoningEffort),
        isMenu: true,
        action: () => openQuickPanel()
      }
    ])

    const disposeTrigger = quickPanel.registerTrigger(QuickPanelReservedSymbol.Thinking, () => openQuickPanel())

    return () => {
      disposeMenu()
      disposeTrigger()
    }
  }, [currentReasoningEffort, openQuickPanel, quickPanel, t])

  return (
    <Tooltip
      placement="top"
      title={
        isThinkingEnabled && supportedOptions.includes('none')
          ? t('common.close')
          : t('assistants.settings.reasoning_effort.label')
      }
      closeDelay={0}>
      <ActionIconButton
        onClick={handleOpenQuickPanel}
        active={currentReasoningEffort !== 'none'}
        icon={ThinkingIcon(currentReasoningEffort)}
      />
    </Tooltip>
  )
}

const ThinkingIcon = (option?: ThinkingOption) => {
  let IconComponent: React.FC<React.SVGProps<SVGSVGElement>> | null = null

  switch (option) {
    case 'minimal':
      IconComponent = MdiLightbulbOn30
      break
    case 'low':
      IconComponent = MdiLightbulbOn50
      break
    case 'medium':
      IconComponent = MdiLightbulbOn80
      break
    case 'high':
      IconComponent = MdiLightbulbOn
      break
    case 'auto':
      IconComponent = MdiLightbulbAutoOutline
      break
    case 'none':
      IconComponent = MdiLightbulbOffOutline
      break
    default:
      IconComponent = MdiLightbulbOffOutline
      break
  }

  return <IconComponent className="icon" width={18} height={18} style={{ marginTop: -2 }} />
}

export default ThinkingButton
