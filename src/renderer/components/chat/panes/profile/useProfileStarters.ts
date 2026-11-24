import { useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePersistCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { ipcApi } from '@renderer/ipc'
import type { ProfileStarterMode } from '@shared/ai/profileStarters'
import type { ProfileStarter } from '@shared/data/cache/cacheValueTypes'

const logger = loggerService.withContext('useProfileStarters')

const GENERATE_TIMEOUT_MS = 30_000
const MAX_PROMPT_CHARS = 6000
const AGENT_SUGGESTIONS_VERSION = 2
// Entries are keyed by Agent or Assistant ID and never pruned on delete, so only the newest are kept.
const MAX_CACHED_OWNERS = 50

const JSON_ONLY = 'Reply with exactly one JSON object and nothing else — no Markdown, no code fences, no commentary.'
// In Chinese the model translated "Agent" as 助手 (Assistant), the UI's word for the other kind.
const KIND_RULE = '- When you name it, use only the given "Kind" word; never call an Agent an Assistant or the reverse.'

const SYSTEM_PROMPTS = {
  agent: [
    'You suggest what the user could do next with a Cherry Studio Agent. They appear as cards in its profile.',
    JSON_ONLY,
    'Shape: {"items":[{"kind":"...","title":"...","hint":"...","prompt":"..."}]}',
    '',
    'Rules:',
    "- 4 to 6 items, the most useful first, tailored to the Agent's role.",
    '- "kind" is one of: schedule (create a scheduled task), github (connect GitHub), skills (find and install skills), memory (remember the user\'s habits), knowledge (link a knowledge base), generic (any other task the Agent can do right now).',
    '- Exclude anything related to messaging channels, including setup, management, and tasks that send or receive messages through them. This applies to every kind, including generic.',
    '- Never suggest what is already set up, and never a capability marked as not supported.',
    '- "title": a short action, at most 30 characters.',
    '- "hint": one short line on what it brings.',
    '- "prompt": the complete message the user sends to the Agent to do it, written as the user.',
    '- Write "title", "hint" and "prompt" in the language of the given locale.',
    KIND_RULE
  ].join('\n'),
  assistant: [
    'You write opening questions a user could ask a Cherry Studio Assistant. They appear as "Try asking" cards in its profile.',
    JSON_ONLY,
    'Shape: {"items":[{"title":"...","hint":"...","prompt":"..."}]}',
    '',
    'Rules:',
    '- Exactly 4 items, each showing a different thing this Assistant is for.',
    '- "title": a short question or request, at most 24 characters.',
    '- "hint": one short line on what the answer gives.',
    '- "prompt": the complete message the user sends; end it with a colon when the user should add their own content.',
    '- Write "title", "hint" and "prompt" in the language of the given locale.',
    KIND_RULE
  ].join('\n')
} as const

// FNV-1a: the cache only needs to notice that the identity changed.
function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export type ProfileStarterIdentity = { name: string; description?: string; prompt?: string }

export type ProfileStarters = {
  /** `unavailable` when the fallback (or nothing) should show instead. */
  status: 'loading' | 'ready' | 'unavailable'
  items: ProfileStarter[]
  hidden: boolean
  hide: () => void
}

/**
 * Agent suggestions or Assistant opening questions, generated once per identity by the default
 * model and cached for the current identity, UI language, and generation rules.
 */
export function useProfileStarters({
  ownerId,
  mode,
  identity,
  context = '',
  ready = true,
  enabled = true
}: {
  /** The Assistant or Agent ID. */
  ownerId: string
  mode: ProfileStarterMode
  identity: ProfileStarterIdentity
  /** Extra input for the model, e.g. what the Agent already has set up; not part of the cache key. */
  context?: string
  /** False while `context` is still loading. */
  ready?: boolean
  /** False when the starters cannot be used, e.g. there is no composer to fill. */
  enabled?: boolean
}): ProfileStarters {
  const { t, i18n } = useTranslation()
  const [hiddenIds, setHiddenIds] = usePersistCache('ui.chat.profile_pane.hidden_starters')
  const hidden = hiddenIds.includes(ownerId)
  const active = enabled && !hidden
  const { defaultModel, isDefaultModelLoading } = useDefaultModel({ enabled: active })
  const [cache, setCache] = usePersistCache('ui.chat.profile_pane.starters')
  const locale = i18n.language
  const kind = t(mode === 'agent' ? 'library.type.agent' : 'library.type.assistant')
  const cacheIdentity = [identity.name, identity.description ?? '', identity.prompt ?? '', locale, kind]
  const hash = hashText(
    JSON.stringify(mode === 'agent' ? [...cacheIdentity, AGENT_SUGGESTIONS_VERSION] : cacheIdentity)
  )
  const entry = cache[ownerId]
  const cached = entry?.hash === hash ? entry.items : undefined
  const requestKey = `${ownerId}:${hash}`
  // Settled result of this mount's request; `null` means it failed and the fallback shows.
  const [result, setResult] = useState<{ key: string; items: ProfileStarter[] | null }>()
  const [lastShown, setLastShown] = useState<{ scope: string; items: ProfileStarter[] | null }>()
  const settled = result?.key === requestKey ? result.items : undefined
  const shouldGenerate = active && ready && !cached && settled === undefined && Boolean(defaultModel)

  const buildInput = useEffectEvent(() =>
    [
      `Kind: ${kind}`,
      `Name: ${identity.name.trim()}`,
      `Description: ${identity.description?.trim() || '(none)'}`,
      `${mode === 'agent' ? 'Instructions' : 'Prompt'}:\n${identity.prompt?.trim().slice(0, MAX_PROMPT_CHARS) || '(none)'}`,
      context,
      `Locale: ${locale}`
    ]
      .filter(Boolean)
      .join('\n\n')
  )

  const settle = useEffectEvent((forHash: string, items: ProfileStarter[] | null) => {
    if (items)
      setCache((previous) => {
        const kept = Object.entries(previous)
          .filter(([id]) => id !== ownerId)
          .slice(-(MAX_CACHED_OWNERS - 1))
        return { ...Object.fromEntries(kept), [ownerId]: { hash: forHash, items } }
      })
    setResult({ key: `${ownerId}:${forHash}`, items })
  })

  useEffect(() => {
    if (!shouldGenerate) return
    let cancelled = false
    const timer = setTimeout(() => {
      cancelled = true
      settle(hash, null)
    }, GENERATE_TIMEOUT_MS)

    void ipcApi
      .request('ai.profile_starters.generate', {
        ownerId,
        mode,
        identityHash: hash,
        system: SYSTEM_PROMPTS[mode],
        prompt: buildInput()
      })
      .catch((error: unknown) => {
        if (!cancelled) logger.warn('Profile starter generation failed', error as Error)
        return null
      })
      .then((items) => {
        if (!cancelled) settle(hash, items)
      })
      .finally(() => clearTimeout(timer))

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [hash, mode, ownerId, shouldGenerate])

  const currentItems = cached ?? settled
  const displayScope = JSON.stringify([ownerId, locale, kind])
  const previousItems = lastShown?.scope === displayScope ? lastShown.items : undefined
  // Retain the Agent's displayed cards during regeneration, including the built-in fallback.
  const items = mode === 'agent' && !currentItems && previousItems !== undefined ? previousItems : currentItems
  if (mode === 'agent' && items !== undefined && items !== previousItems) {
    setLastShown({ scope: displayScope, items })
  }
  const unavailable = !active || items === null || (!items && !defaultModel && !isDefaultModelLoading)
  return {
    status: items ? 'ready' : unavailable ? 'unavailable' : 'loading',
    items: items ?? [],
    hidden,
    hide: () =>
      setHiddenIds((previous) => [...previous.filter((id) => id !== ownerId).slice(-(MAX_CACHED_OWNERS - 1)), ownerId])
  }
}
