import { useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { usePersistCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { fetchGenerate } from '@renderer/utils/aiGeneration'
import { parseJSON } from '@renderer/utils/json'
import type { ProfileStarter, ProfileStarterKind } from '@shared/data/cache/cacheValueTypes'

const logger = loggerService.withContext('useProfileStarters')

const GENERATE_TIMEOUT_MS = 30_000
const MAX_PROMPT_CHARS = 6000

const STARTER_KINDS = [
  'channel-feishu',
  'channel-wechat',
  'schedule',
  'github',
  'skills',
  'memory',
  'knowledge',
  'generic'
] as const satisfies readonly ProfileStarterKind[]

const JSON_ONLY = 'Reply with exactly one JSON object and nothing else — no Markdown, no code fences, no commentary.'

const SYSTEM_PROMPTS = {
  agent: [
    'You suggest what the user could do next with a Cherry Studio Agent. They appear as cards in its profile.',
    JSON_ONLY,
    'Shape: {"items":[{"kind":"...","title":"...","hint":"...","prompt":"..."}]}',
    '',
    'Rules:',
    "- 4 to 6 items, the most useful first, tailored to the Agent's role.",
    '- "kind" is one of: channel-feishu (connect Feishu), channel-wechat (connect WeChat), schedule (create a scheduled task), github (connect GitHub), skills (find and install skills), memory (remember the user\'s habits), knowledge (link a knowledge base), generic (any other task the Agent can do right now).',
    '- Never suggest what is already set up, and never a capability marked as not supported.',
    '- "title": a short action, at most 30 characters.',
    '- "hint": one short line on what it brings.',
    '- "prompt": the complete message the user sends to the Agent to do it, written as the user.',
    '- Write "title", "hint" and "prompt" in the language of the given locale.'
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
    '- Write "title", "hint" and "prompt" in the language of the given locale.'
  ].join('\n')
} as const

const COUNTS = { agent: { min: 4, max: 6 }, assistant: { min: 4, max: 4 } } as const

export type ProfileStarterMode = keyof typeof SYSTEM_PROMPTS

const StarterSchema = z.object({
  kind: z.enum(STARTER_KINDS).catch('generic'),
  title: z.string().trim().min(1),
  hint: z.string().trim().catch(''),
  prompt: z.string().trim().min(1)
})

/** Keeps the well-formed items; `null` when fewer than the minimum remain. */
function parseStarters(text: string, mode: ProfileStarterMode): ProfileStarter[] | null {
  const parsed = z
    .object({ items: z.array(z.unknown()) })
    .safeParse(parseJSON(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)))
  if (!parsed.success) return null
  const items = parsed.data.items.flatMap((item) => {
    const starter = StarterSchema.safeParse(item)
    if (!starter.success) return []
    return [mode === 'assistant' ? { ...starter.data, kind: 'generic' as const } : starter.data]
  })
  const { min, max } = COUNTS[mode]
  return items.length >= min ? items.slice(0, max) : null
}

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
 * model and cached until the name, description, prompt or UI language changes.
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
  const { i18n } = useTranslation()
  const [hiddenIds, setHiddenIds] = usePersistCache('ui.chat.profile_pane.hidden_starters')
  const hidden = hiddenIds.includes(ownerId)
  const active = enabled && !hidden
  const { defaultModel, isDefaultModelLoading } = useDefaultModel({ enabled: active })
  const [cache, setCache] = usePersistCache('ui.chat.profile_pane.starters')
  const locale = i18n.language
  const hash = hashText(JSON.stringify([identity.name, identity.description ?? '', identity.prompt ?? '', locale]))
  const entry = cache[ownerId]
  const cached = entry?.hash === hash ? entry.items : undefined
  const requestKey = `${ownerId}:${hash}`
  // Settled result of this mount's request; `null` means it failed and the fallback shows.
  const [result, setResult] = useState<{ key: string; items: ProfileStarter[] | null }>()
  const settled = result?.key === requestKey ? result.items : undefined
  const shouldGenerate = active && ready && !cached && settled === undefined && Boolean(defaultModel)

  const buildInput = useEffectEvent(() =>
    [
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
    if (items) setCache((previous) => ({ ...previous, [ownerId]: { hash: forHash, items } }))
    setResult({ key: `${ownerId}:${forHash}`, items })
  })

  useEffect(() => {
    if (!shouldGenerate) return
    const controller = new AbortController()
    let cancelled = false
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, GENERATE_TIMEOUT_MS)

    void fetchGenerate({
      prompt: SYSTEM_PROMPTS[mode],
      content: buildInput(),
      throwOnError: true,
      signal: controller.signal
    })
      .then((text) => {
        const items = parseStarters(text, mode)
        if (!items) logger.warn('Generated profile starters did not validate', { mode, ownerId })
        return items
      })
      .catch((error: unknown) => {
        if (!cancelled)
          logger.warn(
            timedOut ? 'Profile starter generation timed out' : 'Profile starter generation failed',
            error as Error
          )
        return null
      })
      .then((items) => {
        if (!cancelled) settle(hash, items)
      })
      .finally(() => clearTimeout(timer))

    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [hash, mode, ownerId, shouldGenerate])

  const items = cached ?? settled
  const unavailable = !active || settled === null || (!items && !defaultModel && !isDefaultModelLoading)
  return {
    status: items ? 'ready' : unavailable ? 'unavailable' : 'loading',
    items: items ?? [],
    hidden,
    hide: () => setHiddenIds((previous) => [...previous.filter((id) => id !== ownerId), ownerId])
  }
}
