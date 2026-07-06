import { cacheService } from '@data/CacheService'
import { AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY } from '@shared/ai/agentSessionSlashCommands'
import type { SlashCommand } from '@shared/ai/slashCommands'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

const EMPTY_SESSION_ID = '__none__'

/**
 * The live slash command catalog for an agent session, captured from the Claude Code SDK
 * (`query.supportedCommands()`) and published into the shared cache by the main process. Includes
 * custom project/user commands — not just the static builtin set. Returns `undefined` when no
 * session is selected or the runtime hasn't reported a catalog yet, so callers fall back to the
 * builtin list. The cached SDK shape (`name` without a leading slash) is normalised to the
 * composer's `{ command, description }` form here.
 *
 * Subscribes to the shared cache directly via `useSyncExternalStore` (rather than `useSharedCache`):
 * that hook seeds the schema default (`null`) on mount when this window's local copy is empty and
 * broadcasts it to Main, which would clobber Main's already-published catalog before the initial
 * sync lands. Main owns this key, so this window must only ever read it — a read that never writes.
 */
export function useAgentSessionSlashCommands(sessionId: string | undefined): SlashCommand[] | undefined {
  const key = AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID)
  const cached = useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.getShared(key), [key]),
    useCallback(() => cacheService.getShared(key), [key]) // SSR snapshot
  )

  return useMemo(() => {
    if (!sessionId || !cached || cached.length === 0) return undefined
    return cached.map((command) => ({ command: `/${command.name}`, description: command.description }))
  }, [sessionId, cached])
}
