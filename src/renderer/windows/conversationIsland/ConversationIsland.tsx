import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import { ipcApi } from '@renderer/ipc'
import type { ConversationIslandSnapshot, ConversationIslandStateKind } from '@shared/types/conversationIsland'

const logger = loggerService.withContext('ConversationIsland')

const STATE_INDICATOR_CLASS: Record<ConversationIslandStateKind, string> = {
  pending: 'bg-info motion-safe:animate-pulse motion-reduce:animate-none',
  streaming: 'bg-primary motion-safe:animate-pulse motion-reduce:animate-none',
  'awaiting-confirmation': 'bg-warning',
  done: 'bg-success',
  error: 'bg-error'
}

export default function ConversationIsland() {
  const snapshot = useWindowInitData<ConversationIslandSnapshot>()

  if (!snapshot) {
    return null
  }

  const usesNotchLayout =
    snapshot.presentation === 'notch' &&
    typeof snapshot.notchWidth === 'number' &&
    Number.isFinite(snapshot.notchWidth) &&
    snapshot.notchWidth > 0

  const stateIndicator = (
    <span className={`size-2 shrink-0 rounded-full ${STATE_INDICATOR_CLASS[snapshot.state]}`} aria-hidden="true" />
  )

  const openConversation = () => {
    void ipcApi
      .request('navigation.focus_or_open_conversation', {
        target: snapshot.target,
        title: snapshot.title
      })
      .catch((error) => logger.error('Failed to open conversation from Conversation Island', error))
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={openConversation}
      data-state={snapshot.state}
      className={
        usesNotchLayout
          ? 'h-full min-h-0 w-full min-w-0 justify-start overflow-hidden rounded-t-none rounded-b-[12px] border-0 bg-black px-0 py-0 text-white text-xs shadow-none hover:bg-black hover:text-white focus-visible:bg-black focus-visible:text-white'
          : 'h-full min-h-0 w-full min-w-0 justify-start overflow-hidden rounded-full border border-border bg-popover/95 px-3 py-0 text-popover-foreground text-xs shadow-md backdrop-blur-xs hover:bg-accent focus-visible:bg-accent'
      }>
      {usesNotchLayout ? (
        <span className="grid h-full w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <span data-testid="notch-leading" className="flex min-w-0 items-center gap-2 overflow-hidden pl-3 text-left">
            {stateIndicator}
            <span className="min-w-0 truncate font-medium">{snapshot.statusText}</span>
          </span>
          <span data-testid="notch-occlusion" aria-hidden="true" style={{ width: snapshot.notchWidth }} />
          <span
            data-testid="notch-trailing"
            className="flex min-w-0 items-center justify-end gap-2 overflow-hidden pr-3">
            <span className="min-w-0 truncate text-white/60">{snapshot.title}</span>
            {snapshot.secondaryCount > 0 ? (
              <span className="shrink-0 rounded-full bg-white/10 px-1.5 text-white/70">+{snapshot.secondaryCount}</span>
            ) : null}
          </span>
        </span>
      ) : (
        <>
          {stateIndicator}
          <span className="shrink-0 font-medium">{snapshot.statusText}</span>
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{snapshot.title}</span>
          {snapshot.secondaryCount > 0 ? (
            <span className="shrink-0 rounded-full bg-accent px-1.5 text-muted-foreground">
              +{snapshot.secondaryCount}
            </span>
          ) : null}
        </>
      )}
    </Button>
  )
}
