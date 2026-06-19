import { isMac, platform } from '@renderer/config/constant'
import { resolveCommandDisplayState } from '@renderer/utils/command'
import {
  type CommandId,
  findCommandDefinition,
  findKeybindingRule,
  type MenuLocation,
  menuRegistry,
  resolveCommandKeybinding,
  type ResolvedMenuModel,
  type SupportedPlatform
} from '@shared/command'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useCommandContextReader } from './useCommandContext'
import { useCommandRuntime, useCommandShortcutPreferences } from './useCommandRuntime'

export function useResolvedCommandMenu(location: MenuLocation): ResolvedMenuModel<CommandId> {
  const { t } = useTranslation()
  const runtime = useCommandRuntime()
  const context = useCommandContextReader()
  const shortcutPreferences = useCommandShortcutPreferences()

  return useMemo(
    () =>
      menuRegistry.resolve({
        location,
        context,
        getCommandState: (command) => {
          const definition = findCommandDefinition(command)
          const rule = findKeybindingRule(command)
          const preference = rule ? shortcutPreferences[command] : undefined
          const keybinding = resolveCommandKeybinding({
            command,
            preference,
            context,
            platform: platform as SupportedPlatform
          })
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
            ...state,
            accelerator: keybinding?.accelerator
          }
        }
      }),
    [context, location, runtime, shortcutPreferences, t]
  )
}
