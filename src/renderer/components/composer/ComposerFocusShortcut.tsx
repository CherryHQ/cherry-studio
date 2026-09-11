import { CommandShortcut } from '@renderer/components/command'
import { useCommandHandler, useResolvedCommand } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'

export function ComposerFocusShortcut({ focus, editable = true }: { focus: () => void; editable?: boolean }) {
  const isActiveTab = useIsActiveTab()
  const { shortcutLabel, label } = useResolvedCommand('chat.input.focus')
  useCommandHandler('chat.input.focus', focus, { enabled: isActiveTab && editable })

  if (!editable || !shortcutLabel) return null

  return (
    <span className="pointer-events-none z-1 mt-2 mr-8 flex h-5 shrink-0 select-none items-center self-start group-has-[:focus]/composer-editor:hidden [[data-composer-presentation=compact]_&]:mt-0 [[data-composer-presentation=compact]_&]:self-center">
      <CommandShortcut
        command="chat.input.focus"
        className="h-5 rounded-md bg-muted/50 px-1.5 font-normal text-foreground-tertiary"
      />
      {/* The keycap is aria-hidden, so without this the hint is invisible to assistive
          technology — the shortcut would have no announceable form on the composer. */}
      <span className="sr-only">{label}</span>
    </span>
  )
}
