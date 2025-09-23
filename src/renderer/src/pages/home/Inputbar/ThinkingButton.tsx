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
import { Model, ThinkingOption } from '@renderer/types'
import { Tooltip } from 'antd'
import { FC, ReactElement, useCallback, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export interface ThinkingButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<ThinkingButtonRef | null>
  model: Model
  assistantId: string
}

const ThinkingButton: FC<Props> = ({ ref, model, assistantId }): ReactElement => {
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const { assistant, updateAssistantSettings } = useAssistant(assistantId)

  const currentReasoningEffort = useMemo(() => {
    return assistant.settings?.reasoning_effort || 'off'
  }, [assistant.settings?.reasoning_effort])

  // 确定当前模型支持的选项类型
  const modelType = useMemo(() => getThinkModelType(model), [model])

  // 获取当前模型支持的选项
  const supportedOptions: ThinkingOption[] = useMemo(() => {
    if (modelType === 'doubao') {
      if (isDoubaoThinkingAutoModel(model)) {
        return ['off', 'auto', 'high']
      }
      return ['off', 'high']
    }
    return MODEL_SUPPORTED_OPTIONS[modelType]
  }, [model, modelType])

  const onThinkingChange = useCallback(
    (option?: ThinkingOption) => {
      const isEnabled = option !== undefined && option !== 'off'
      // 然后更新设置
      if (!isEnabled) {
        updateAssistantSettings({
          reasoning_effort: undefined,
          reasoning_effort_cache: undefined,
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

  const isThinkingEnabled = currentReasoningEffort !== undefined && currentReasoningEffort !== 'off'

  const disableThinking = useCallback(() => {
    onThinkingChange('off')
  }, [onThinkingChange])

  const openQuickPanel = useCallback(() => {
    quickPanel.open({
      title: t('assistants.settings.reasoning_effort.label'),
      list: panelItems,
      symbol: QuickPanelReservedSymbol.Thinking
    })
  }, [quickPanel, panelItems, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === QuickPanelReservedSymbol.Thinking) {
      quickPanel.close()
      return
    }

    if (isThinkingEnabled && supportedOptions.includes('off')) {
      disableThinking()
      return
    }
    openQuickPanel()
  }, [openQuickPanel, quickPanel, isThinkingEnabled, supportedOptions, disableThinking])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip
      placement="top"
      title={
        isThinkingEnabled && supportedOptions.includes('off')
          ? t('common.close')
          : t('assistants.settings.reasoning_effort.label')
      }
      mouseLeaveDelay={0}
      arrow>
      <ActionIconButton onClick={handleOpenQuickPanel} active={currentReasoningEffort !== 'off'}>
        {ThinkingIcon(currentReasoningEffort)}
      </ActionIconButton>
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
    case 'off':
      IconComponent = MdiLightbulbOffOutline
      break
    default:
      IconComponent = MdiLightbulbOffOutline
      break
  }

  return <IconComponent className="icon" width={18} height={18} style={{ marginTop: -2 }} />
}

export default ThinkingButton
