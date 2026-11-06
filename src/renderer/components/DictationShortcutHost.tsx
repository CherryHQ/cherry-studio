import { useDictationMouseHold } from '@renderer/hooks/useDictationMouseHold'
import { useDictationShortcuts } from '@renderer/hooks/useDictationShortcuts'

export function DictationShortcutHost(): null {
  useDictationShortcuts()
  useDictationMouseHold()
  return null
}
