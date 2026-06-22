import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import {
  MdiLightbulbAutoOutline,
  MdiLightbulbOffOutline,
  MdiLightbulbOn,
  MdiLightbulbOn30,
  MdiLightbulbOn50,
  MdiLightbulbOn80,
  MdiLightbulbOn90,
  MdiLightbulbQuestion
} from '@renderer/components/Icons/SvgIcon'
import {
  getThinkModelType,
  isDoubaoThinkingAutoModel,
  isFixedReasoningModel,
  isGPT5SeriesReasoningModel,
  isOpenAIWebSearchModel,
  isReasoningModel,
  MODEL_SUPPORTED_OPTIONS
} from '@renderer/config/models'
import { cacheService } from '@renderer/data/CacheService'
import { useAssistant } from '@renderer/hooks/useAssistant'
import type { ThinkingOption } from '@renderer/types'
import type { Model } from '@shared/data/types/model'
import type { FC, SVGProps } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  launcher: ToolLauncherApi
  model: Model
  assistantId?: string
  reasoningEffort?: ThinkingOption
  onReasoningEffortChange?: (option: ThinkingOption) => void
}

const useThinkingToolController = ({
  launcher,
  model,
  assistantId,
  reasoningEffort: controlledEffort,
  onReasoningEffortChange
}: Props) => {
  const { t } = useTranslation()
  const isControlled = controlledEffort !== undefined
  const { assistant, updateAssistantSettings } = useAssistant(assistantId)

  const currentReasoningEffort = useMemo<ThinkingOption>(() => {
    if (isControlled) return controlledEffort
    const stored = assistant?.settings.reasoning_effort
    return (stored ?? 'none') as ThinkingOption
  }, [isControlled, controlledEffort, assistant?.settings.reasoning_effort])

  // 确定当前模型支持的选项类型
  const modelType = useMemo(() => getThinkModelType(model), [model])

  const supportsReasoning = isReasoningModel(model)
  const isFixedReasoning = isFixedReasoningModel(model)

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
    (option: ThinkingOption) => {
      const isEnabled = option !== 'none'

      if (isControlled) {
        onReasoningEffortChange?.(option)
        return
      }

      if (!isEnabled) {
        cacheService.set(`assistant.reasoning_effort_cache.${assistantId}`, option)
        updateAssistantSettings({
          reasoning_effort: option
        })
        return
      }
      if (
        isOpenAIWebSearchModel(model) &&
        isGPT5SeriesReasoningModel(model) &&
        assistant?.settings.enableWebSearch &&
        option === 'minimal'
      ) {
        window.toast.warning(t('chat.web_search.warning.openai'))
        return
      }
      cacheService.set(`assistant.reasoning_effort_cache.${assistantId}`, option)
      updateAssistantSettings({
        reasoning_effort: option
      })
    },
    [
      isControlled,
      onReasoningEffortChange,
      updateAssistantSettings,
      assistantId,
      assistant?.settings.enableWebSearch,
      model,
      t
    ]
  )

  const reasoningEffortOptionLabelMap = useMemo(
    () =>
      ({
        default: t('assistants.settings.reasoning_effort.default'),
        none: t('assistants.settings.reasoning_effort.off'),
        minimal: t('assistants.settings.reasoning_effort.minimal'),
        high: t('assistants.settings.reasoning_effort.high'),
        low: t('assistants.settings.reasoning_effort.low'),
        medium: t('assistants.settings.reasoning_effort.medium'),
        auto: t('assistants.settings.reasoning_effort.auto'),
        xhigh: t('assistants.settings.reasoning_effort.xhigh')
      }) as const satisfies Record<ThinkingOption, string>,
    [t]
  )

  const currentReasoningEffortLabel = reasoningEffortOptionLabelMap[currentReasoningEffort]

  const isThinkingEnabled =
    currentReasoningEffort !== undefined && currentReasoningEffort !== 'none' && currentReasoningEffort !== 'default'

  const cycleOptions = useMemo(
    () => supportedOptions.filter((option): option is ThinkingOption => option !== 'default'),
    [supportedOptions]
  )

  const isReasoningConfigurable = supportsReasoning && !isFixedReasoning && cycleOptions.length > 0

  const disabledReason = useMemo(() => {
    if (!supportsReasoning) {
      return t('chat.input.thinking.unsupported_model')
    }
    if (isFixedReasoning) {
      return t('chat.input.thinking.fixed_model')
    }
    return undefined
  }, [isFixedReasoning, supportsReasoning, t])

  const cycleThinking = useCallback(() => {
    if (!isReasoningConfigurable) return

    const currentIndex = cycleOptions.indexOf(currentReasoningEffort)
    if (cycleOptions.length === 1 && currentIndex === 0) return

    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % cycleOptions.length
    onThinkingChange(cycleOptions[nextIndex])
  }, [currentReasoningEffort, cycleOptions, isReasoningConfigurable, onThinkingChange])

  const reasoningSubmenu = useMemo(
    () =>
      isReasoningConfigurable
        ? cycleOptions.map((option, index) => ({
            id: `thinking-${option}`,
            kind: 'command' as const,
            sources: ['popover'] as const,
            order: 60 + index / 100,
            label: reasoningEffortOptionLabelMap[option],
            description: t('assistants.settings.reasoning_effort.label'),
            icon: ThinkingIcon({ option }),
            active: currentReasoningEffort === option,
            action: () => onThinkingChange(option)
          }))
        : [],
    [currentReasoningEffort, cycleOptions, isReasoningConfigurable, onThinkingChange, reasoningEffortOptionLabelMap, t]
  )

  useEffect(() => {
    const disposeLauncher = launcher.registerLaunchers([
      {
        id: 'thinking',
        kind: 'group',
        sources: ['popover'],
        order: 60,
        label: t('assistants.settings.reasoning_effort.label'),
        description: '',
        disabledReason,
        icon: ThinkingIcon({ option: currentReasoningEffort }),
        active: isReasoningConfigurable && isThinkingEnabled,
        showInActiveControls: false,
        disabled: !isReasoningConfigurable,
        suffix: currentReasoningEffortLabel,
        submenu: reasoningSubmenu,
        action: cycleThinking
      }
    ])

    return () => {
      disposeLauncher()
    }
  }, [
    currentReasoningEffort,
    currentReasoningEffortLabel,
    cycleThinking,
    disabledReason,
    isFixedReasoning,
    isReasoningConfigurable,
    isThinkingEnabled,
    launcher,
    reasoningSubmenu,
    t
  ])
}

export const ThinkingToolRuntime: FC<Props> = (props) => {
  useThinkingToolController(props)
  return null
}

const ThinkingIcon = (props: { option?: ThinkingOption; isFixedReasoning?: boolean }) => {
  let IconComponent: FC<SVGProps<SVGSVGElement>> | null = null
  if (props.isFixedReasoning) {
    IconComponent = MdiLightbulbAutoOutline
  } else {
    switch (props.option) {
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
        IconComponent = MdiLightbulbOn90
        break
      case 'xhigh':
        IconComponent = MdiLightbulbOn
        break
      case 'auto':
        IconComponent = MdiLightbulbAutoOutline
        break
      case 'none':
        IconComponent = MdiLightbulbOffOutline
        break
      case 'default':
      default:
        IconComponent = MdiLightbulbQuestion
        break
    }
  }

  return <IconComponent className="icon" width={18} height={18} style={{ marginTop: -2 }} />
}
