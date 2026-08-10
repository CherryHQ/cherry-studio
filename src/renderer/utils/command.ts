import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { ContextReader, RegisteredCommandDefinition, SupportedPlatform } from '@shared/types/command'
import { type CommandId, evaluateContextExpr, resolveCommandKeybinding } from '@shared/utils/command'
import { formatShortcutDisplay } from '@shared/utils/shortcut'

export { getShortcutBindingFromKeyboardEvent } from '@shared/utils/shortcut'

/**
 * Renderer-only command presentation helpers. Cross-process shortcut parsing
 * and command resolution live in the shared layer.
 */

export const getCommandShortcutLabel = (
  command: CommandId,
  preference: PreferenceShortcutType | null | undefined,
  options: {
    context: ContextReader
    isMac: boolean
    platform?: SupportedPlatform
  }
): string => {
  const resolved = resolveCommandKeybinding({
    command,
    preference,
    context: options.context,
    platform: options.platform
  })

  if (!resolved?.enabled || !resolved.binding.length) {
    return ''
  }

  return formatShortcutDisplay(resolved.binding, options.isMac)
}

export interface CommandDisplayState {
  label: string
  enabled: boolean
  iconKey?: string
  shortcutLabel: string
}

/**
 * Shared per-command display computation used by {@link useResolvedCommand} and
 * {@link useResolvedCommandMenu}. Renderer concerns (`hasHandler`, `translate`)
 * are injected so the function stays pure.
 */
export const resolveCommandDisplayState = (
  command: CommandId,
  options: {
    definition: RegisteredCommandDefinition<CommandId> | undefined
    preference: PreferenceShortcutType | null | undefined
    context: ContextReader
    hasHandler: (command: CommandId) => boolean
    translate: (key: string) => string
    isMac: boolean
    platform?: SupportedPlatform
  }
): CommandDisplayState => {
  const { definition, preference, context, hasHandler, translate } = options

  return {
    label: definition ? translate(definition.titleKey) : command,
    enabled: Boolean(definition && hasHandler(command) && evaluateContextExpr(definition.enablement, context)),
    iconKey: definition?.iconKey,
    shortcutLabel: getCommandShortcutLabel(command, preference, {
      context,
      isMac: options.isMac,
      platform: options.platform
    })
  }
}
