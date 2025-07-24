import {
  MdiLightbulbAutoOutline,
  MdiLightbulbOffOutline,
  MdiLightbulbOn10,
  MdiLightbulbOn50,
  MdiLightbulbOn90
} from '@renderer/components/Icons/SVGIcon'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import {
  GEMINI_FLASH_MODEL_REGEX,
  isDoubaoThinkingAutoModel,
  isSupportedReasoningEffortGrokModel,
  isSupportedThinkingTokenDoubaoModel,
  isSupportedThinkingTokenGeminiModel,
  isSupportedThinkingTokenHunyuanModel,
  isSupportedThinkingTokenQwenModel
} from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { Assistant, Model, ReasoningEffortOptions } from '@renderer/types'
import { Tooltip } from 'antd'
import { FC, ReactElement, useCallback, useEffect, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type ThinkingOption = ReasoningEffortOptions | 'off'

export interface ThinkingButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<ThinkingButtonRef | null>
  model: Model
  assistant: Assistant
  ToolbarButton: any
}

// 模型类型到支持选项的映射表
const MODEL_SUPPORTED_OPTIONS: Record<string, ThinkingOption[]> = {
  default: ['off', 'low', 'medium', 'high'],
  grok: ['low', 'high'],
  gemini: ['off', 'low', 'medium', 'high', 'auto'],
  gemini_pro: ['low', 'medium', 'high', 'auto'],
  qwen: ['off', 'low', 'medium', 'high'],
  doubao: ['off', 'auto', 'high'],
  hunyuan: ['off', 'auto']
}

// 选项转换映射表：当选项不支持时使用的替代选项
const OPTION_FALLBACK: Record<ThinkingOption, ThinkingOption> = {
  off: 'low', // off -> low (for Gemini Pro models)
  low: 'high',
  medium: 'high', // medium -> high (for Grok models)
  high: 'high',
  auto: 'high' // auto -> high (for non-Gemini models)
}

const ThinkingButton: FC<Props> = ({ ref, model, assistant, ToolbarButton }): ReactElement => {
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
  const { updateAssistantSettings } = useAssistant(assistant.id)

  const isGrokModel = isSupportedReasoningEffortGrokModel(model)
  const isGeminiModel = isSupportedThinkingTokenGeminiModel(model)
  const isGeminiFlashModel = GEMINI_FLASH_MODEL_REGEX.test(model.id)
  const isQwenModel = isSupportedThinkingTokenQwenModel(model)
  const isDoubaoModel = isSupportedThinkingTokenDoubaoModel(model)
  const isHunyuanModel = isSupportedThinkingTokenHunyuanModel(model)

  const currentReasoningEffort = useMemo(() => {
    return assistant.settings?.reasoning_effort || 'off'
  }, [assistant.settings?.reasoning_effort])

  // 确定当前模型支持的选项类型
  const modelType = useMemo(() => {
    if (isGeminiModel) {
      if (isGeminiFlashModel) {
        return 'gemini'
      } else {
        return 'gemini_pro'
      }
    }
    if (isGrokModel) return 'grok'
    if (isQwenModel) return 'qwen'
    if (isDoubaoModel) return 'doubao'
    if (isHunyuanModel) return 'hunyuan'
    return 'default'
  }, [isGeminiModel, isGrokModel, isQwenModel, isDoubaoModel, isGeminiFlashModel, isHunyuanModel])

  // 获取当前模型支持的选项
  const supportedOptions = useMemo(() => {
    if (modelType === 'doubao') {
      if (isDoubaoThinkingAutoModel(model)) {
        return ['off', 'auto', 'high'] as ThinkingOption[]
      }
      return ['off', 'high'] as ThinkingOption[]
    }
    return MODEL_SUPPORTED_OPTIONS[modelType]
  }, [model, modelType])

  // 检查当前设置是否与当前模型兼容
  useEffect(() => {
    if (currentReasoningEffort && !supportedOptions.includes(currentReasoningEffort)) {
      // 使用表中定义的替代选项
      const fallbackOption = OPTION_FALLBACK[currentReasoningEffort as ThinkingOption]

      updateAssistantSettings({
        reasoning_effort: fallbackOption === 'off' ? undefined : fallbackOption,
        qwenThinkMode: fallbackOption === 'off'
      })
    }
  }, [currentReasoningEffort, supportedOptions, updateAssistantSettings, model.id])

  const createThinkingIcon = useCallback((option?: ThinkingOption, isActive: boolean = false) => {
    const iconColor = isActive ? 'var(--color-link)' : 'var(--color-icon)'

    switch (true) {
      case option === 'low':
        return <MdiLightbulbOn10 width={18} height={18} style={{ color: iconColor, marginTop: -2 }} />
      case option === 'medium':
        return <MdiLightbulbOn50 width={18} height={18} style={{ color: iconColor, marginTop: -2 }} />
      case option === 'high':
        return <MdiLightbulbOn90 width={18} height={18} style={{ color: iconColor, marginTop: -2 }} />
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
          qwenThinkMode: false
        })
        return
      }
      updateAssistantSettings({
        reasoning_effort: option,
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
      label: t(`assistants.settings.reasoning_effort.${option === 'auto' ? 'default' : option}`),
      description: '',
      icon: createThinkingIcon(option),
      isSelected: currentReasoningEffort === option,
      action: () => onThinkingChange(option)
    }))
  }, [t, createThinkingIcon, currentReasoningEffort, supportedOptions, onThinkingChange])

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
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanel])

  // 获取当前应显示的图标
  const getThinkingIcon = useCallback(() => {
    // 如果当前选项不支持，显示回退选项的图标
    if (currentReasoningEffort && !supportedOptions.includes(currentReasoningEffort)) {
      const fallbackOption = OPTION_FALLBACK[currentReasoningEffort as ThinkingOption]
      return createThinkingIcon(fallbackOption, true)
    }
    return createThinkingIcon(currentReasoningEffort, currentReasoningEffort !== 'off')
  }, [createThinkingIcon, currentReasoningEffort, supportedOptions])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip placement="top" title={t('assistants.settings.reasoning_effort.label')} mouseLeaveDelay={0} arrow>
      <ToolbarButton type="text" onClick={handleOpenQuickPanel}>
        {getThinkingIcon()}
      </ToolbarButton>
    </Tooltip>
  )
}

export default ThinkingButton
