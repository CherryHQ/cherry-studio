import { quickChatInputSchema, type QuickChatInput } from '@shared/ipc/schemas/quickAssistant'

/** Parse the public launcher contract without executing a prompt or logging its contents. */
export function parseChatProtocolUrl(url: URL): QuickChatInput | null {
  if (
    url.protocol !== 'cherrystudio:' ||
    url.hostname !== 'chat' ||
    url.pathname !== '/new' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    return null
  }

  const allowedParameters = new Set(['prompt', 'temporary', 'submit'])
  for (const key of url.searchParams.keys()) {
    if (!allowedParameters.has(key) || url.searchParams.getAll(key).length !== 1) return null
  }
  for (const key of ['temporary', 'submit']) {
    const value = url.searchParams.get(key)
    if (value !== null && value !== 'true' && value !== 'false') return null
  }

  const result = quickChatInputSchema.safeParse({
    prompt: url.searchParams.get('prompt') ?? '',
    temporary: url.searchParams.get('temporary') === 'true',
    submit: url.searchParams.get('submit') === 'true'
  })
  return result.success ? result.data : null
}
