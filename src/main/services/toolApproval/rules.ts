/**
 * CRUD over the persisted `PermissionRule[]` collection.
 *
 * Storage: `PreferenceService` under key `tools.permission_rules`. Cross-
 * window sync is automatic (cherry's Preference layer broadcasts on
 * change). Returned arrays are fresh copies so callers can't mutate the
 * canonical store.
 */

import { application } from '@application'

import type { PermissionRule } from './types'

const KEY = 'tools.permission_rules'

function pref() {
  return application.get('PreferenceService')
}

export async function loadRules(): Promise<PermissionRule[]> {
  return [...pref().get(KEY)]
}

/**
 * Insert or replace a rule by id. Replaces in-place to preserve order
 * relative to other rules (so user ordering in a future settings UI is
 * stable across edits).
 */
export async function saveRule(rule: PermissionRule): Promise<void> {
  const current = await loadRules()
  const idx = current.findIndex((r) => r.id === rule.id)
  if (idx === -1) current.push(rule)
  else current[idx] = rule
  await pref().set(KEY, current)
}

export async function updateRule(id: string, patch: Partial<Omit<PermissionRule, 'id'>>): Promise<void> {
  const current = await loadRules()
  const idx = current.findIndex((r) => r.id === id)
  if (idx === -1) throw new Error(`Rule not found: ${id}`)
  current[idx] = { ...current[idx], ...patch, id }
  await pref().set(KEY, current)
}

export async function deleteRule(id: string): Promise<void> {
  const current = await loadRules()
  const next = current.filter((r) => r.id !== id)
  if (next.length === current.length) return
  await pref().set(KEY, next)
}
