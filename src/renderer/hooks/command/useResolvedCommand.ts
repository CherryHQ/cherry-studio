import { usePreference } from '@data/hooks/usePreference'
import { isMac, platform } from '@renderer/config/constant'
import { resolveCommandDisplayState } from '@renderer/utils/command'
import type { ResolvedCommandState, SupportedPlatform } from '@shared/types/command'
import { type CommandId, findCommandDefinition, findKeybindingRule } from '@shared/utils/command'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useCommandContextReader } from './useCommandContext'
import { useCommandRuntime } from './useCommandRuntime'

export function useResolvedCommand(command: CommandId): ResolvedCommandState & { execute: () => void } {
  const { t } = useTranslation()
  const runtime = useCommandRuntime()
  const context = useCommandContextReader()
  const definition = findCommandDefinition(command)
  const rule = findKeybindingRule(command)
  const [preference] = usePreference(rule?.preferenceKey ?? 'shortcut.topic.create')

  return useMemo(() => {
    const state = resolveCommandDisplayState(command, {
      definition,
      preference,
      context,
      hasHandler: runtime.hasHandler,
      translate: t,
      isMac,
      platform: platform as SupportedPlatform
    })

    return {
      id: command,
      ...state,
      execute: () => runtime.execute(command)
    }
  }, [command, context, definition, preference, runtime, t])
}
