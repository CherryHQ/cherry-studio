import { CommandShortcut } from '@renderer/components/command'
import { useCommandHandler } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'

export function ComposerFocusShortcut({ focus, editable = true }: { focus: () => void; editable?: boolean }) {
  const isActiveTab = useIsActiveTab()
  useCommandHandler('chat.input.focus', focus, { enabled: isActiveTab && editable })

  if (!editable) return null

  return (
    <CommandShortcut
      command="chat.input.focus"
      className="pointer-events-none z-1 mt-2 mr-8 h-5 shrink-0 self-start rounded-md bg-muted/50 px-1.5 font-normal text-foreground-tertiary group-has-[:focus]/composer-editor:invisible [[data-composer-presentation=compact]_&]:mt-0 [[data-composer-presentation=compact]_&]:self-center"
    />
  )
}
