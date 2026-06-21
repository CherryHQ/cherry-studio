import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { ContextReader, RegisteredCommandDefinition, SupportedPlatform } from '@shared/types/command'
import { type CommandId, evaluateContextExpr, resolveCommandKeybinding } from '@shared/utils/command'
import {
  convertKeyToAccelerator,
  formatShortcutDisplay,
  normalizeShortcutBinding,
  type ShortcutBinding,
  type ShortcutToken
} from '@shared/utils/shortcut'

/**
 * Renderer-only command presentation / DOM-input helpers. The cross-process
 * command resolution core stays in `@shared/command`; these consume it but are
 * never used by the main process (display strings, DOM `KeyboardEvent` parsing),
 * so they live in the renderer.
 */

export interface KeyboardEventLike {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

const getEventKeyToken = (event: KeyboardEventLike) => {
  const fromCode = event.code ? convertKeyToAccelerator(event.code) : undefined
  const fromKey = convertKeyToAccelerator(event.key)
  const token = fromCode ?? fromKey

  if (
    token === 'CommandOrControl' ||
    token === 'Command' ||
    token === 'Ctrl' ||
    token === 'Alt' ||
    token === 'AltGr' ||
    token === 'Shift' ||
    token === 'Meta'
  ) {
    return undefined
  }

  return token
}

export const getShortcutBindingFromKeyboardEvent = (
  event: KeyboardEventLike,
  platform?: SupportedPlatform
): ShortcutBinding => {
  const binding: ShortcutToken[] = []

  if (platform === 'darwin') {
    if (event.metaKey) binding.push('CommandOrControl')
    if (event.ctrlKey) binding.push('Ctrl')
  } else {
    if (event.ctrlKey) binding.push('CommandOrControl')
    if (event.metaKey) binding.push(platform ? 'Meta' : 'CommandOrControl')
  }

  if (event.altKey) binding.push('Alt')
  if (event.shiftKey) binding.push('Shift')

  const keyToken = getEventKeyToken(event)
  if (keyToken) {
    binding.push(keyToken)
  }

  return normalizeShortcutBinding(binding)
}

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
