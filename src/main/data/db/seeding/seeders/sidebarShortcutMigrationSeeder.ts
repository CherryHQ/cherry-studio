import { and, eq } from 'drizzle-orm'

import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { preferenceTable } from '@data/db/schemas/preference'
import {
  createSidebarShortcutId,
  type SidebarShortcutItem,
  type SidebarShortcutTarget
} from '@shared/data/preference/preferenceTypes'

import type { DbType, ISeeder } from '../../types'

const SIDEBAR_FAVORITES_KEY = 'ui.sidebar.favorites'
const SIDEBAR_SHORTCUT_KEY = 'ui.sidebar_shortcut'
const LEGACY_PROVIDER_BY_TYPE = {
  app: 'core.app',
  mini_app: 'core.mini-app',
  agent: 'core.agent',
  assistant: 'core.assistant'
} as const

type StoredSidebarItem = Record<string, unknown>

function isRecord(value: unknown): value is StoredSidebarItem {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isShortcutTarget(value: unknown): value is SidebarShortcutTarget {
  if (!isRecord(value) || value.kind !== 'resource' || !isRecord(value.locator)) return false
  return (
    typeof value.locator.providerId === 'string' &&
    value.locator.providerId.length > 0 &&
    typeof value.locator.resourceId === 'string' &&
    value.locator.resourceId.length > 0 &&
    (value.activationId === undefined || (typeof value.activationId === 'string' && value.activationId.length > 0))
  )
}

function createShortcut(target: SidebarShortcutTarget, fallbackLabel?: string): SidebarShortcutItem {
  return {
    type: 'shortcut',
    id: createSidebarShortcutId(target),
    target,
    ...(fallbackLabel ? { fallbackLabel } : {})
  }
}

export class SidebarShortcutMigrationSeeder implements ISeeder {
  readonly name = 'sidebar-shortcut-migration'
  readonly version = '2'
  readonly description = 'Copy legacy sidebar favorites to a separate resource shortcut preference'

  run(db: DbType): void {
    const existing = db
      .select({ key: preferenceTable.key })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, SIDEBAR_SHORTCUT_KEY)))
      .get()
    if (existing) return

    const [row] = db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, SIDEBAR_FAVORITES_KEY)))
      .all()
    if (!Array.isArray(row?.value)) return

    const legacyTypes = new Set(
      row.value.flatMap((value) =>
        isRecord(value) && typeof value.type === 'string' && value.type in LEGACY_PROVIDER_BY_TYPE ? [value.type] : []
      )
    )

    const names = new Map<string, string>()
    if (legacyTypes.has('mini_app')) {
      for (const item of db.select({ id: miniAppTable.appId, name: miniAppTable.name }).from(miniAppTable).all()) {
        names.set(`mini_app:${item.id}`, item.name)
      }
    }
    if (legacyTypes.has('agent')) {
      for (const item of db.select({ id: agentTable.id, name: agentTable.name }).from(agentTable).all()) {
        names.set(`agent:${item.id}`, item.name)
      }
    }
    if (legacyTypes.has('assistant')) {
      for (const item of db.select({ id: assistantTable.id, name: assistantTable.name }).from(assistantTable).all()) {
        names.set(`assistant:${item.id}`, item.name)
      }
    }

    const seen = new Set<string>()
    const migrated: unknown[] = []

    for (const value of row.value) {
      if (!isRecord(value)) {
        continue
      }

      let next: unknown = value
      let identity: string | undefined
      if (value.type === 'shortcut' && isShortcutTarget(value.target)) {
        const shortcut = createShortcut(
          value.target,
          typeof value.fallbackLabel === 'string' ? value.fallbackLabel : undefined
        )
        identity = shortcut.id
        next = shortcut
      } else if (
        typeof value.type === 'string' &&
        value.type in LEGACY_PROVIDER_BY_TYPE &&
        typeof value.id === 'string' &&
        value.id.length > 0
      ) {
        const legacyType = value.type as keyof typeof LEGACY_PROVIDER_BY_TYPE
        const target: SidebarShortcutTarget = {
          kind: 'resource',
          locator: { providerId: LEGACY_PROVIDER_BY_TYPE[legacyType], resourceId: value.id }
        }
        next = createShortcut(target, names.get(`${legacyType}:${value.id}`))
        identity = createSidebarShortcutId(target)
      } else if (typeof value.type === 'string' && typeof value.id === 'string' && value.id.length > 0) {
        identity = `${value.type}:${value.id}`
      } else {
        continue
      }

      if (identity && seen.has(identity)) {
        continue
      }
      if (identity) seen.add(identity)
      migrated.push(next)
    }

    db.insert(preferenceTable)
      .values({ scope: 'default', key: SIDEBAR_SHORTCUT_KEY, value: migrated })
      .onConflictDoNothing()
      .run()
  }
}
