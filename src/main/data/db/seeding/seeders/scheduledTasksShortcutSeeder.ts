import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'
import type { DbType, ISeeder } from '@data/db/types'
import { createSidebarShortcutId, type SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'

export class ScheduledTasksShortcutSeeder implements ISeeder {
  readonly name = 'scheduled-tasks-shortcut'
  readonly version = '1'
  readonly description = 'Add the scheduled tasks shortcut once without reordering existing shortcuts'

  run(db: DbType): void {
    const scope = and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'ui.sidebar_shortcut'))
    const row = db.select().from(preferenceTable).where(scope).get()
    if (!row || !Array.isArray(row.value)) return
    const appId = (item: unknown): string | undefined => {
      const shortcut = item as { target?: { locator?: { providerId?: string; resourceId?: string } } } | null
      return shortcut?.target?.locator?.providerId === 'core.app' ? shortcut.target.locator.resourceId : undefined
    }
    if (row.value.some((item) => appId(item) === 'scheduled_tasks')) return
    const items = [...row.value]
    const after = items.findLastIndex((item) => ['agents', 'assistants'].includes(appId(item) ?? ''))
    const target: SidebarShortcutTarget = {
      kind: 'resource',
      locator: { providerId: 'core.app', resourceId: 'scheduled_tasks' }
    }
    items.splice(after < 0 ? items.length : after + 1, 0, {
      type: 'shortcut',
      id: createSidebarShortcutId(target),
      target
    })
    db.update(preferenceTable).set({ value: items }).where(scope).run()
  }
}
