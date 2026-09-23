/**
 * The bounded write surface of the doctor Agent.
 *
 * Every write maps onto a path the app already validates (DataApi PATCH handlers, PreferenceService,
 * DoctorService.fix); this module only decides which of those the Agent may reach and captures the
 * snapshot an undo needs. Reads go through the same DataApi server with secrets redacted.
 */

import { randomUUID } from 'node:crypto'

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

/** Preferences a diagnosis plausibly needs to change; everything else is read-only to the Agent. */
export const PREFERENCE_WRITE_ALLOWLIST: ReadonlySet<UnifiedPreferenceKeyType> = new Set<UnifiedPreferenceKeyType>([
  'app.proxy.mode',
  'app.proxy.url',
  'app.proxy.bypass_rules',
  'chat.default_model_id',
  'app.dist.auto_update.enabled',
  'BootConfig.app.disable_hardware_acceleration'
])

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

export function isPreferenceWritable(key: string): key is UnifiedPreferenceKeyType {
  return PREFERENCE_WRITE_ALLOWLIST.has(key as UnifiedPreferenceKeyType)
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

/** In-process DataApi call; the handler layer validates, this layer redacts. */
export async function queryDataApi(input: DataApiQuery): Promise<{ status: number; data?: unknown; error?: unknown }> {
  const response = await application.get('DataApiService').getApiServer().handleRequest({
    id: randomUUID(),
    method: input.method,
    path: input.path,
    params: input.query,
    body: input.body
  })
  return {
    status: response.status,
    ...(response.data !== undefined ? { data: redactForModel(response.data) } : {}),
    ...(response.error ? { error: response.error } : {})
  }
}

/** Refuses a PATCH body that names a credential field, whatever the handler would do with it. */
export function assertNoSecretFields(body: Record<string, unknown>): void {
  const secret = Object.keys(body).find((key) => isSensitiveKey(key))
  if (secret) throw new Error(`Refusing to write credential field "${secret}"; ask the user to enter it in Settings`)
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

export async function applyWrite(write: DoctorAgentWrite): Promise<AppliedWrite> {
  switch (write.kind) {
    case 'data_api_patch': {
      const current = await queryDataApi({ method: 'GET', path: write.path })
      if (current.error || typeof current.data !== 'object' || current.data === null) {
        throw new Error(`Cannot read ${write.path} before patching: ${failureMessage(current.error ?? 'no data')}`)
      }
      const before = Object.fromEntries(
        Object.keys(write.body).map((key) => [key, (current.data as Record<string, unknown>)[key] ?? null])
      )
      const result = await queryDataApi({ method: 'PATCH', path: write.path, body: { ...write.body } })
      if (result.error) throw new Error(failureMessage(result.error))
      return { before, undoable: true }
    }
    case 'preference_set': {
      if (!isPreferenceWritable(write.key)) throw new Error(`Preference "${write.key}" is not writable by the doctor`)
      const preferences = application.get('PreferenceService')
      const before = preferences.get(write.key)
      await preferences.set(write.key, write.value as never)
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

export async function undoWrite(write: DoctorAgentWrite, before: unknown): Promise<void> {
  switch (write.kind) {
    case 'data_api_patch': {
      const result = await queryDataApi({
        method: 'PATCH',
        path: write.path,
        body: { ...(before as Record<string, unknown>) }
      })
      if (result.error) throw new Error(failureMessage(result.error))
      return
    }
    case 'preference_set':
      await application.get('PreferenceService').set(write.key as UnifiedPreferenceKeyType, before as never)
      return
    case 'doctor_fix':
      throw new Error('Catalog fixes cannot be undone')
  }
}
