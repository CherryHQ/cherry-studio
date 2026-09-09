import { CommandShortcut } from '@renderer/components/command'
import { useCommandHandler, useResolvedCommand } from '@renderer/hooks/command'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { useTranslation } from 'react-i18next'

export function ComposerFocusShortcut({ focus, editable = true }: { focus: () => void; editable?: boolean }) {
  const { t } = useTranslation()
  const isActiveTab = useIsActiveTab()
  const { shortcutLabel } = useResolvedCommand('chat.input.focus')
  useCommandHandler('chat.input.focus', focus, { enabled: isActiveTab && editable })

  if (!editable || !shortcutLabel) return null

  return (
    <span className="pointer-events-none z-1 mt-2 mr-8 flex h-5 shrink-0 select-none items-center gap-1 self-start text-foreground-tertiary text-xs group-has-[:focus]/composer-editor:invisible [[data-composer-presentation=compact]_&]:mt-0 [[data-composer-presentation=compact]_&]:self-center">
      <CommandShortcut
        command="chat.input.focus"
        className="h-5 rounded-md bg-muted/50 px-1.5 font-normal text-foreground-tertiary"
      />
      {t('chat.input.focus_hint')}
    </span>
  )
}
