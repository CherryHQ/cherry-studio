import { jobScheduleTable } from '@data/db/schemas/job'
import { jobScheduleService } from '@data/services/JobScheduleService'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('JobScheduleService', () => {
  const dbh = setupTestDatabase()

  const baseTrigger: Trigger = { kind: 'interval', ms: 60_000 }

  describe('create', () => {
    it('writes singleton sentinel "" when name is undefined', async () => {
      const snap = await jobScheduleService.create({
        type: 'agent.task',
        trigger: baseTrigger,
        jobInputTemplate: { foo: 'bar' },
        catchUpPolicy: { kind: 'skip-missed' }
      })

      // External snapshot: `null` (singleton)
      expect(snap.name).toBeNull()

      // Internal DB row: `''` (sentinel)
      const [row] = await dbh.db.select().from(jobScheduleTable).where(eq(jobScheduleTable.id, snap.id))
      expect(row.name).toBe('')
    })

    it('writes the supplied name when one is provided', async () => {
      const snap = await jobScheduleService.create({
        type: 'agent.task',
        name: 'nightly-report',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(snap.name).toBe('nightly-report')
      const [row] = await dbh.db.select().from(jobScheduleTable).where(eq(jobScheduleTable.id, snap.id))
      expect(row.name).toBe('nightly-report')
    })

    it('throws SCHEDULE_SINGLETON_EXISTS when creating a second unnamed schedule for the same type', async () => {
      await jobScheduleService.create({
        type: 'agent.task',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      await expect(
        jobScheduleService.create({
          type: 'agent.task',
          trigger: baseTrigger,
          jobInputTemplate: {},
          catchUpPolicy: { kind: 'skip-missed' }
        })
      ).rejects.toThrow(JOB_ERROR_CODES.SCHEDULE_SINGLETON_EXISTS)
    })

    it('throws SCHEDULE_NAME_CONFLICT when (type, name) collides', async () => {
      await jobScheduleService.create({
        type: 'agent.task',
        name: 'morning-digest',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      await expect(
        jobScheduleService.create({
          type: 'agent.task',
          name: 'morning-digest',
          trigger: baseTrigger,
          jobInputTemplate: {},
          catchUpPolicy: { kind: 'skip-missed' }
        })
      ).rejects.toThrow(JOB_ERROR_CODES.SCHEDULE_NAME_CONFLICT)
    })

    it('throws SCHEDULE_NAME_INVALID when name starts with reserved "__" prefix', async () => {
      await expect(
        jobScheduleService.create({
          type: 'agent.task',
          name: '__system',
          trigger: baseTrigger,
          jobInputTemplate: {},
          catchUpPolicy: { kind: 'skip-missed' }
        })
      ).rejects.toThrow(JOB_ERROR_CODES.SCHEDULE_NAME_INVALID)
    })

    it('throws SCHEDULE_NAME_INVALID when name contains a control character', async () => {
      await expect(
        jobScheduleService.create({
          type: 'agent.task',
          name: 'has\ttab',
          trigger: baseTrigger,
          jobInputTemplate: {},
          catchUpPolicy: { kind: 'skip-missed' }
        })
      ).rejects.toThrow(JOB_ERROR_CODES.SCHEDULE_NAME_INVALID)
    })

    it('allows different types to each have their own singleton', async () => {
      const a = await jobScheduleService.create({
        type: 'agent.task',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const b = await jobScheduleService.create({
        type: 'knowledge.index-documents',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      expect(a.name).toBeNull()
      expect(b.name).toBeNull()
    })
  })

  describe('update', () => {
    it('renames a schedule when patch.name is set to a valid value', async () => {
      const snap = await jobScheduleService.create({
        type: 'agent.task',
        name: 'old-name',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      const updated = await jobScheduleService.update(snap.id, { name: 'new-name' })
      expect(updated?.name).toBe('new-name')
    })

    it('throws SCHEDULE_NAME_CONFLICT when patch.name collides with an existing row', async () => {
      await jobScheduleService.create({
        type: 'agent.task',
        name: 'first',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const second = await jobScheduleService.create({
        type: 'agent.task',
        name: 'second',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      await expect(jobScheduleService.update(second.id, { name: 'first' })).rejects.toThrow(
        JOB_ERROR_CODES.SCHEDULE_NAME_CONFLICT
      )
    })

    it('throws SCHEDULE_NAME_INVALID when patch.name violates the atom schema', async () => {
      const snap = await jobScheduleService.create({
        type: 'agent.task',
        name: 'valid-name',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      await expect(jobScheduleService.update(snap.id, { name: 'has\nnewline' })).rejects.toThrow(
        JOB_ERROR_CODES.SCHEDULE_NAME_INVALID
      )
    })

    it('returns null when updating a non-existent id', async () => {
      const result = await jobScheduleService.update('does-not-exist', { enabled: false })
      expect(result).toBeNull()
    })

    it('clears the name back to singleton when patch.name is explicitly null', async () => {
      const snap = await jobScheduleService.create({
        type: 'agent.task',
        name: 'will-be-cleared',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      const updated = await jobScheduleService.update(snap.id, { name: null })
      expect(updated?.name).toBeNull()

      const [row] = await dbh.db.select().from(jobScheduleTable).where(eq(jobScheduleTable.id, snap.id))
      expect(row.name).toBe('')
    })
  })

  describe('getByTypeAndName', () => {
    it('returns the singleton row when called with name=""', async () => {
      const snap = await jobScheduleService.create({
        type: 'agent.task',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      const found = await jobScheduleService.getByTypeAndName('agent.task', '')
      expect(found?.id).toBe(snap.id)
      expect(found?.name).toBeNull()
    })

    it('returns the named row when called with the matching name', async () => {
      const snap = await jobScheduleService.create({
        type: 'agent.task',
        name: 'nightly',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      const found = await jobScheduleService.getByTypeAndName('agent.task', 'nightly')
      expect(found?.id).toBe(snap.id)
    })

    it('returns null when no row matches', async () => {
      const found = await jobScheduleService.getByTypeAndName('agent.task', 'missing')
      expect(found).toBeNull()
    })
  })

  describe('listNamesForType', () => {
    it('returns user-visible names and filters out the singleton sentinel', async () => {
      await jobScheduleService.create({
        type: 'agent.task',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      await jobScheduleService.create({
        type: 'agent.task',
        name: 'morning',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      await jobScheduleService.create({
        type: 'agent.task',
        name: 'evening',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      const names = await jobScheduleService.listNamesForType('agent.task')
      expect(names).toEqual(expect.arrayContaining(['morning', 'evening']))
      expect(names).toHaveLength(2)
      expect(names).not.toContain('')
    })

    it('returns an empty array when no schedule matches the type', async () => {
      const names = await jobScheduleService.listNamesForType('unknown.type')
      expect(names).toEqual([])
    })
  })
})
