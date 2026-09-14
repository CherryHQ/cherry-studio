import * as z from 'zod'

import { decodeText } from './meeting'

export const ACCOUNT_URL = 'https://cherrymousetest.sonicrhino.cc/api/user.user/userinfo'
export type Fetch = (
  input: Parameters<Window['cherry']['network']['fetch']>[0]
) => ReturnType<Window['cherry']['network']['fetch']>
export type Access = { token: string; userId: string; revoked: boolean }
const userSchema = z.object({
  data: z.object({ user: z.object({ id: z.union([z.string().min(1), z.number().int()]) }) })
})

export function assertAccess(access: Access): void {
  if (access.revoked) throw new Error('accessExpired')
}

export async function verifyAccessToken(
  token: string,
  fetch: Fetch = (input) => window.cherry.network.fetch(input)
): Promise<Access> {
  const normalized = token.trim()
  if (
    !normalized ||
    normalized.length > 4096 ||
    [...normalized].some((char) => char.charCodeAt(0) < 33 || char.charCodeAt(0) > 126)
  )
    throw new Error('invalidToken')
  let response: Awaited<ReturnType<Fetch>>
  try {
    response = await fetch({
      url: ACCOUNT_URL,
      method: 'GET',
      headers: { accept: 'application/json', token: normalized }
    })
  } catch {
    throw new Error('authUnavailable')
  }
  if (response.status === 401 || response.status === 403) throw new Error('invalidToken')
  if (response.status !== 200) throw new Error('authUnavailable')
  let value: unknown
  try {
    value = JSON.parse(decodeText(response.body))
  } catch {
    throw new Error('authUnavailable')
  }
  const envelope = z.object({ code: z.number() }).safeParse(value)
  if (!envelope.success) throw new Error('authUnavailable')
  if (envelope.data.code !== 1) throw new Error('invalidToken')
  const user = userSchema.safeParse(value)
  if (!user.success) throw new Error('authUnavailable')
  return { token: normalized, userId: String(user.data.data.user.id), revoked: false }
}

export async function refreshAccess(access: Access, fetch?: Fetch): Promise<void> {
  assertAccess(access)
  try {
    const verified = await verifyAccessToken(access.token, fetch)
    assertAccess(access)
    if (verified.userId !== access.userId) throw new Error('invalidToken')
  } catch (error) {
    access.revoked = true
    access.token = ''
    if (error instanceof Error && error.message === 'authUnavailable') throw error
    throw new Error('accessExpired')
  }
}
