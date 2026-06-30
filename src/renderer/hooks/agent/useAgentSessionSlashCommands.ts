import { cacheService } from '@renderer/data/CacheService'
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
 * Read-only by design: it subscribes to the shared-cache store directly rather than via
 * `useSharedCache`, which seeds the schema default on mount when this window's local copy is empty.
 * That default is `null`, and the seed write broadcasts to Main — so a window mounting before
 * `syncSharedCacheFromMain()` lands would clobber Main's already-published catalog. Reading without
 * writing lets the sync deliver Main's value untouched (Main owns this key).
 */
export function useAgentSessionSlashCommands(sessionId: string | undefined): SlashCommand[] | undefined {
  const key = AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID)
  const cached = useSyncExternalStore(
    useCallback((onChange) => cacheService.subscribe(key, onChange), [key]),
    useCallback(() => cacheService.getShared(key), [key]),
    useCallback(() => cacheService.getShared(key), [key])
  )

  return useMemo(() => {
    if (!sessionId || !cached || cached.length === 0) return undefined
    return cached.map((command) => ({ command: `/${command.name}`, description: command.description }))
  }, [sessionId, cached])
}
