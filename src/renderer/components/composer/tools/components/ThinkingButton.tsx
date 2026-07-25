import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import {
  MdiLightbulbAutoOutline,
  MdiLightbulbOffOutline,
  MdiLightbulbOn,
  MdiLightbulbOn30,
  MdiLightbulbOn50,
  MdiLightbulbOn80,
  MdiLightbulbOn90,
  MdiLightbulbQuestion
} from '@renderer/components/icons/SvgIcon'
import { toast } from '@renderer/services/toast'
import type { Assistant } from '@renderer/types/assistant'
import type { ThinkingOption } from '@renderer/types/reasoning'
import { isGPT5SeriesReasoningModel, isOpenAIWebSearchModel, isReasoningModel } from '@renderer/utils/model'
import { deriveThinkingOptions } from '@shared/ai/reasoning'
import type { Model } from '@shared/data/types/model'
import type { FC, SVGProps } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  launcher: ToolLauncherApi
  model: Model
  assistant?: Assistant
  reasoningEffort?: ThinkingOption
  onReasoningEffortChange?: (option: ThinkingOption) => void
}

const useThinkingToolController = ({
  launcher,
  model,
  assistant,
  reasoningEffort: controlledEffort,
  onReasoningEffortChange
}: Props) => {
  const { t } = useTranslation()
  const currentReasoningEffort = useMemo<ThinkingOption>(() => {
    return controlledEffort ?? ((assistant?.settings.reasoning_effort ?? 'default') as ThinkingOption)
  }, [controlledEffort, assistant?.settings.reasoning_effort])

  const supportsReasoning = isReasoningModel(model)

  // Descriptor-driven vocabulary (#16598): the registry controls declaration
  // decides the options — the same derivation the injector's contract test
  // validates, so the UI can never offer an unserializable option.
  const supportedOptions: ThinkingOption[] = useMemo(() => deriveThinkingOptions(model) ?? [], [model])

  // Reasons but exposes no knob (fixed reasoning / a provider that ignores
  // reasoning params).
  const isFixedReasoning = supportsReasoning && supportedOptions.length === 0

  const onThinkingChange = useCallback(
    (option: ThinkingOption) => {
      if (
        isOpenAIWebSearchModel(model) &&
        isGPT5SeriesReasoningModel(model) &&
        assistant?.settings.enableWebSearch &&
        option === 'minimal'
      ) {
        toast.warning(t('chat.web_search.warning.openai'))
        return
      }
      onReasoningEffortChange?.(option)
    },
    [onReasoningEffortChange, assistant?.settings.enableWebSearch, model, t]
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
        xhigh: t('assistants.settings.reasoning_effort.xhigh'),
        max: t('assistants.settings.reasoning_effort.max')
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
        ? supportedOptions.map((option, index) => ({
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
    [
      currentReasoningEffort,
      isReasoningConfigurable,
      onThinkingChange,
      reasoningEffortOptionLabelMap,
      supportedOptions,
      t
    ]
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
        searchAliases: getQuickPanelSearchAliases(t, 'assistants.settings.reasoning_effort.label', [
          'think',
          'reasoning effort'
        ]),
        disabledReason,
        icon: ThinkingIcon({ option: currentReasoningEffort }),
        active: isReasoningConfigurable && isThinkingEnabled,
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
      case 'max':
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
