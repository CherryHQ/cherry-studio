import path from 'node:path'

import Database from 'better-sqlite3'
import * as z from 'zod'

import { application } from '@application'
import type { KiroQuotaIdentity } from '@cherrystudio/agent-runtime-kiro-acp'
import { isMac, isWin } from '@main/core/platform'

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_at: z.string(),
  profile_arn: z.string().nullish()
})
const profileSchema = z.object({ arn: z.string().min(1) })

export function readKiroQuotaIdentity(env: Readonly<Record<string, string>>): KiroQuotaIdentity | undefined {
  if (isWin || env.KIRO_API_KEY?.trim()) return
  const root =
    env.KIRO_DATA_DIR?.trim() ||
    (!isMac && env.XDG_DATA_HOME?.trim() ? path.join(env.XDG_DATA_HOME, 'kiro-cli') : undefined)
  if (root ? !path.isAbsolute(root) : env.HOME && env.HOME !== application.getPath('sys.home')) return
  const filename = root ? path.join(root, 'data.sqlite3') : application.getPath('external.kiro.state.file')
  let db: Database.Database
  try {
    db = new Database(filename, { readonly: true, fileMustExist: true, timeout: 250 })
  } catch {
    return
  }
  try {
    const rows = db
      .prepare<[], { key: string; value: string }>(`
      SELECT key, value FROM state WHERE key = 'api.codewhisperer.profile'
      UNION ALL
      SELECT key, value FROM auth_kv WHERE key IN ('kirocli:social:token', 'kirocli:odic:token')
    `)
      .all()
    const profile = profileSchema.safeParse(
      JSON.parse(rows.find(({ key }) => key === 'api.codewhisperer.profile')?.value ?? 'null')
    )
    if (!profile.success) return
    const profileArn = profile.data.arn
    const tokens = new Set<string>()
    for (const row of rows) {
      if (row.key === 'api.codewhisperer.profile') continue
      const token = tokenSchema.safeParse(JSON.parse(row.value))
      if (!token.success || !(Date.parse(token.data.expires_at) > Date.now())) continue
      if (token.data.profile_arn && token.data.profile_arn !== profileArn) continue
      tokens.add(token.data.access_token)
    }
    const [accessToken] = tokens
    return tokens.size === 1 ? { accessToken, profileArn } : undefined
  } finally {
    db.close()
  }
}
