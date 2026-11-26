import { shell } from 'electron'

import { getShellEnv } from '@main/utils/shellEnv'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

export async function getCursorApiKey(config: LocalAgentConfiguration, signal?: AbortSignal) {
  return config.env.CURSOR_API_KEY ?? (await getShellEnv(signal)).CURSOR_API_KEY
}

export async function getCursorAuthStatus(config: LocalAgentConfiguration) {
  try {
    const { cursorAuthStatus } = await import('@cherrystudio/agent-runtime-cursor')
    return await cursorAuthStatus(await getCursorApiKey(config))
  } catch {
    return 'unknown' as const
  }
}

export async function authenticateCursor(methodId: string, signal: AbortSignal) {
  const { cursorLogin } = await import('@cherrystudio/agent-runtime-cursor')
  signal.throwIfAborted()
  await cursorLogin(methodId, signal, async (url) => {
    signal.throwIfAborted()
    if (new URL(url).protocol !== 'https:') throw new Error('Invalid Cursor login URL')
    await shell.openExternal(url)
  })
}
