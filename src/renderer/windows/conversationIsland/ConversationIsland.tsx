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

  const openConversation = () => {
    void ipcApi
      .request('navigation.focus_or_open_conversation', {
        target: snapshot.target,
        title: snapshot.navigationTitle
      })
      .catch((error) => logger.error('Failed to open conversation from Conversation Island', error))
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={openConversation}
      data-state={snapshot.state}
      className={`h-full min-h-0 w-full min-w-0 justify-start overflow-hidden border border-border bg-popover/95 px-3 py-0 text-popover-foreground text-xs shadow-md backdrop-blur-xs hover:bg-accent focus-visible:bg-accent ${
        snapshot.presentation === 'notch' ? 'rounded-t-none rounded-b-xl' : 'rounded-full'
      }`}>
      <span className={`size-2 shrink-0 rounded-full ${STATE_INDICATOR_CLASS[snapshot.state]}`} aria-hidden="true" />
      <span className="shrink-0 font-medium">{snapshot.statusText}</span>
      {snapshot.title ? (
        <>
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{snapshot.title}</span>
        </>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      {snapshot.secondaryCount > 0 ? (
        <span className="shrink-0 rounded-full bg-accent px-1.5 text-muted-foreground">+{snapshot.secondaryCount}</span>
      ) : null}
    </Button>
  )
}
