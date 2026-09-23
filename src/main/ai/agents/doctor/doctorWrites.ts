/**
 * The bounded write surface of the doctor Agent.
 *
 * Every write maps onto a path the app already validates (DataApi PATCH handlers, PreferenceService,
 * DoctorService.fix); this module only decides which of those the Agent may reach and captures the
 * snapshot an undo needs. Reads go through the same DataApi server with secrets redacted.
 */

import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import * as z from 'zod'

import { application } from '@application'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import type { DoctorFixResult } from '@shared/types/doctor'
import type { DoctorAgentWrite } from '@shared/types/doctorAgent'
import { doctorFixMeta } from '@shared/utils/doctor'
import { isSensitiveKey, redactDeep, redactSecretText } from '@shared/utils/redaction'

/** Entities whose PATCH handlers already whitelist mutable fields and never accept credentials. */
const DATA_API_PATCH_PATHS: readonly RegExp[] = [
  /^\/providers\/[^/]+$/,
  /^\/mcp-servers\/[^/]+$/,
  /^\/assistants\/[^/]+$/,
  /^\/agents\/[^/]+$/
]

const credentialFreeUrl = z.string().refine(
  (value) => {
    if (value === '') return true
    try {
      const url = new URL(value)
      return !url.username && !url.password
    } catch {
      return false
    }
  },
  { message: 'must be a valid URL without embedded credentials' }
)

/** Preferences a diagnosis plausibly needs to change, each with the value shape the runtime expects. */
const PREFERENCE_WRITE_SCHEMAS = {
  'app.proxy.mode': z.enum(['system', 'custom', 'none']),
  'app.proxy.url': credentialFreeUrl,
  'app.proxy.bypass_rules': z.string(),
  'chat.default_model_id': z.string().min(1).nullable(),
  'app.dist.auto_update.enabled': z.boolean(),
  'BootConfig.app.disable_hardware_acceleration': z.boolean()
} as const satisfies Partial<Record<UnifiedPreferenceKeyType, z.ZodType>>

export type DoctorWritablePreferenceKey = keyof typeof PREFERENCE_WRITE_SCHEMAS

export const PREFERENCE_WRITE_ALLOWLIST: ReadonlySet<string> = new Set(Object.keys(PREFERENCE_WRITE_SCHEMAS))

export function isPreferenceWritable(key: string): key is DoctorWritablePreferenceKey {
  return PREFERENCE_WRITE_ALLOWLIST.has(key)
}

/** The value an allow-listed preference write may carry, or a thrown validation error. */
export function parsePreferenceWrite(key: string, value: unknown): { key: DoctorWritablePreferenceKey; value: unknown } {
  if (!isPreferenceWritable(key)) throw new Error(`Preference "${key}" is not writable by the doctor`)
  const parsed = PREFERENCE_WRITE_SCHEMAS[key].safeParse(value)
  if (!parsed.success) throw new Error(`Invalid value for "${key}": ${parsed.error.issues[0]?.message ?? 'rejected'}`)
  return { key, value: parsed.data }
}

/** Key-name redaction plus in-value secrets (URL userinfo, bearer tokens) that key names never reveal. */
export function redactForModel(value: unknown): unknown {
  const walk = (val: unknown): unknown => {
    if (typeof val === 'string') return redactSecretText(val)
    if (Array.isArray(val)) return val.map(walk)
    if (typeof val === 'object' && val !== null) {
      return Object.fromEntries(Object.entries(val).map(([key, item]) => [key, walk(item)]))
    }
    return val
  }
  return walk(redactDeep(value))
}

export function isDataApiPatchPath(path: string): boolean {
  return DATA_API_PATCH_PATHS.some((pattern) => pattern.test(path))
}

/** `auto` runs without a click: only catalog fixes that revert on their own and need no relaunch. */
export function writeRisk(write: DoctorAgentWrite): 'auto' | 'confirm' {
  if (write.kind !== 'doctor_fix') return 'confirm'
  const meta = doctorFixMeta(write.request.checkId, write.request.fixId)
  return meta.reversible && !meta.relaunch ? 'auto' : 'confirm'
}

export interface DataApiQuery {
  readonly method: 'GET' | 'PATCH'
  readonly path: string
  readonly query?: Record<string, unknown>
  readonly body?: Record<string, unknown>
}

interface DataApiResult {
  readonly status: number
  readonly data?: unknown
  readonly error?: unknown
}

/** Raw in-process DataApi call; never hand its `data` to the model. */
async function fetchDataApi(input: DataApiQuery): Promise<DataApiResult> {
  const response = await application.get('DataApiService').getApiServer().handleRequest({
    id: randomUUID(),
    method: input.method,
    path: input.path,
    params: input.query,
    body: input.body
  })
  return {
    status: response.status,
    ...(response.data !== undefined ? { data: response.data } : {}),
    ...(response.error ? { error: response.error } : {})
  }
}

/** In-process DataApi call; the handler layer validates, this layer redacts. */
export async function queryDataApi(input: DataApiQuery): Promise<DataApiResult> {
  const result = await fetchDataApi(input)
  return result.data !== undefined ? { ...result, data: redactForModel(result.data) } : result
}

/** Refuses a PATCH body that names a credential field at any depth, whatever the handler would do with it. */
export function assertNoSecretFields(body: Record<string, unknown>): void {
  const walk = (value: unknown, trail: string[]): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...trail, String(index)]))
      return
    }
    if (typeof value !== 'object' || value === null) return
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        throw new Error(
          `Refusing to write credential field "${[...trail, key].join('.')}"; ask the user to enter it in Settings`
        )
      }
      walk(item, [...trail, key])
    }
  }
  walk(body, [])
}

export interface AppliedWrite {
  readonly before: unknown
  readonly undoable: boolean
  readonly fix?: DoctorFixResult
}

function failureMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
}

async function readEntity(path: string): Promise<Record<string, unknown>> {
  const current = await fetchDataApi({ method: 'GET', path })
  if (current.error || typeof current.data !== 'object' || current.data === null) {
    throw new Error(`Cannot read ${path}: ${failureMessage(current.error ?? 'no data')}`)
  }
  return current.data as Record<string, unknown>
}

export async function applyWrite(write: DoctorAgentWrite): Promise<AppliedWrite> {
  switch (write.kind) {
    case 'data_api_patch': {
      assertNoSecretFields(write.body)
      const raw = await readEntity(write.path)
      const redacted = redactForModel(raw) as Record<string, unknown>
      const before: Record<string, unknown> = {}
      for (const key of Object.keys(write.body)) {
        // A field whose stored value changes under redaction carries a credential; the snapshot
        // would leak it or, once redacted, destroy it on undo. Such fields are off limits.
        if (!isDeepStrictEqual(raw[key] ?? null, redacted[key] ?? null)) {
          throw new Error(`Refusing to write "${key}": its current value carries credentials`)
        }
        before[key] = raw[key] ?? null
      }
      const result = await fetchDataApi({ method: 'PATCH', path: write.path, body: { ...write.body } })
      if (result.error) throw new Error(failureMessage(result.error))
      return { before, undoable: true }
    }
    case 'preference_set': {
      const { key, value } = parsePreferenceWrite(write.key, write.value)
      const preferences = application.get('PreferenceService')
      const before = preferences.get(key)
      await preferences.set(key, value as never)
      return { before, undoable: true }
    }
    case 'doctor_fix': {
      const fix = await application.get('DoctorService').fix(write.request)
      if (fix.status === 'failed') throw new Error(fix.message)
      if (fix.status === 'stale') throw new Error(`Fix is stale: ${fix.reason}`)
      return { before: null, undoable: false, fix }
    }
  }
}

/** Restores `before` only while the stored value is still what the write put there. */
export async function undoWrite(write: DoctorAgentWrite, before: unknown): Promise<void> {
  switch (write.kind) {
    case 'data_api_patch': {
      const raw = await readEntity(write.path)
      for (const [key, written] of Object.entries(write.body)) {
        if (!isDeepStrictEqual(raw[key] ?? null, written ?? null)) {
          throw new Error(`"${key}" changed since the doctor wrote it; nothing was restored`)
        }
      }
      const result = await fetchDataApi({
        method: 'PATCH',
        path: write.path,
        body: { ...(before as Record<string, unknown>) }
      })
      if (result.error) throw new Error(failureMessage(result.error))
      return
    }
    case 'preference_set': {
      const { key } = parsePreferenceWrite(write.key, write.value)
      const preferences = application.get('PreferenceService')
      if (!isDeepStrictEqual(preferences.get(key), write.value)) {
        throw new Error(`"${key}" changed since the doctor wrote it; nothing was restored`)
      }
      await preferences.set(key, before as never)
      return
    }
    case 'doctor_fix':
      throw new Error('Catalog fixes cannot be undone')
  }
}
