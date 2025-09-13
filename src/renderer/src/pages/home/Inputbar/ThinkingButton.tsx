import { Tooltip } from '@heroui/react'
import {
  MdiLightbulbAutoOutline,
  MdiLightbulbOffOutline,
  MdiLightbulbOn,
  MdiLightbulbOn30,
  MdiLightbulbOn50,
  MdiLightbulbOn80
} from '@renderer/components/Icons/SVGIcon'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { getThinkModelType, isDoubaoThinkingAutoModel, MODEL_SUPPORTED_OPTIONS } from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { getReasoningEffortOptionsLabel } from '@renderer/i18n/label'
import { Assistant, Model, ThinkingOption } from '@renderer/types'
import { FC, ReactElement, useCallback, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export interface ThinkingButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<ThinkingButtonRef | null>
  model: Model
  assistant: Assistant
  ToolbarButton: any
}

const ThinkingButton: FC<Props> = ({ ref, model, assistant, ToolbarButton }): ReactElement => {
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const { updateAssistantSettings } = useAssistant(assistant.id)

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

  const createThinkingIcon = useCallback((option?: ThinkingOption, isActive: boolean = false) => {
    const iconColor = isActive ? 'var(--color-primary)' : 'var(--color-icon)'

    switch (true) {
      case option === 'minimal':
        return <MdiLightbulbOn30 width={18} height={18} style={{ color: iconColor, marginTop: -2 }} />
      case option === 'low':
        return <MdiLightbulbOn50 width={18} height={18} style={{ color: iconColor, marginTop: -2 }} />
      case option === 'medium':
        return <MdiLightbulbOn80 width={18} height={18} style={{ color: iconColor, marginTop: -2 }} />
      case option === 'high':
        return <MdiLightbulbOn width={18} height={18} style={{ color: iconColor, marginTop: -2 }} />
      case option === 'auto':
        return <MdiLightbulbAutoOutline width={18} height={18} style={{ color: iconColor, marginTop: -2 }} />
      case option === 'off':
        return <MdiLightbulbOffOutline width={18} height={18} style={{ color: iconColor, marginTop: -2 }} />
      default:
        return <MdiLightbulbOffOutline width={18} height={18} style={{ color: iconColor }} />
    }
  }, [])

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
      updateAssistantSettings({
        reasoning_effort: option,
        reasoning_effort_cache: option,
        qwenThinkMode: true
      })
      return
    },
    [updateAssistantSettings]
  )

  const panelItems = useMemo(() => {
    // 使用表中定义的选项创建UI选项
    return supportedOptions.map((option) => ({
      level: option,
      label: getReasoningEffortOptionsLabel(option),
      description: '',
      icon: createThinkingIcon(option),
      isSelected: currentReasoningEffort === option,
      action: () => onThinkingChange(option)
    }))
  }, [createThinkingIcon, currentReasoningEffort, supportedOptions, onThinkingChange])

  const isThinkingEnabled = currentReasoningEffort !== undefined && currentReasoningEffort !== 'off'

  const disableThinking = useCallback(() => {
    onThinkingChange('off')
  }, [onThinkingChange])

  const openQuickPanel = useCallback(() => {
    quickPanel.open({
      title: t('assistants.settings.reasoning_effort.label'),
      list: panelItems,
      symbol: 'thinking'
    })
  }, [quickPanel, panelItems, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanel.isVisible && quickPanel.symbol === 'thinking') {
      quickPanel.close()
      return
    }

    if (isThinkingEnabled && supportedOptions.includes('off')) {
      disableThinking()
      return
    }
    openQuickPanel()
  }, [openQuickPanel, quickPanel, isThinkingEnabled, supportedOptions, disableThinking])

  // 获取当前应显示的图标
  const getThinkingIcon = useCallback(() => {
    // 不再判断选项是否支持，依赖 useAssistant 更新选项为支持选项的行为
    return createThinkingIcon(currentReasoningEffort, currentReasoningEffort !== 'off')
  }, [createThinkingIcon, currentReasoningEffort])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip
      placement="top"
      content={
        isThinkingEnabled && supportedOptions.includes('off')
          ? t('common.close')
          : t('assistants.settings.reasoning_effort.label')
      }
      showArrow={true}>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        {getThinkingIcon()}
      </ToolbarButton>
    </Tooltip>
  )
}

export default ThinkingButton
