import { randomUUID } from 'node:crypto'
import { access, mkdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { _electron as electron } from '@playwright/test'
import { v7 as uuidv7 } from 'uuid'

import type { IpcResult } from '../../../src/shared/ipc/errors/IpcError'
import type { OutputFor } from '../../../src/shared/ipc/types'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, provideApp, testInfo) => {
    const profile = testInfo.outputPath('profile')
    await mkdir(profile, { recursive: true })
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile }
    delete env.ELECTRON_RENDERER_URL
    const app = await electron.launch({
      args: ['.'],
      env: Object.fromEntries(Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== undefined)),
      timeout: 60_000
    })
    try {
      await provideApp(app)
    } finally {
      try {
        await app.close()
      } finally {
        await rm(profile, { recursive: true, force: true, maxRetries: 3 })
      }
    }
  }
})

const RELEASE =
  'Image-generation job references are released automatically when the job record is cleaned up, normally about 7 days after the job finishes; older records can be removed sooner and cleanup may be delayed. This file becomes eligible for background cleanup only after every reference is released, and other references can still block deletion.'

// A job-held archived image must disclose its holder while preserving the file, job and association.
test('Archive names the image-generation job blocking permanent deletion', async ({ mainWindow: page }, testInfo) => {
  const previous = await page.evaluate(async () => ({
    language: await window.api.preference.get('app.language'),
    onboarding: await window.api.preference.get('app.onboarding.provider_setup.status'),
    privacyVersion: await window.api.preference.get('app.privacy.policy_version')
  }))
  const ids = { entryId: uuidv7(), jobId: uuidv7(), refId: randomUUID() }
  const now = Date.now()
  const name = `Archive job holder ${now} ${ids.entryId}`
  let db: DatabaseSync | undefined
  try {
    await page.evaluate(async (privacyVersion) => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('app.privacy.policy_version', privacyVersion)
    }, LATEST_PRIVACY_POLICY_VERSION)
    await page.reload()
    await expect(page.locator('[data-ui~="app.content"]')).toBeVisible({ timeout: 60_000 })

    const result = await page.evaluate(
      async () => (await window.api.ipcApi.request('app.get_info')) as IpcResult<OutputFor<'app.get_info'>>
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('app.get_info failed')
    const dbPath = join(result.data.appDataPath, 'Data', 'cherrystudio.sqlite')
    await access(dbPath)
    const relativePath = relative(await realpath(testInfo.outputPath('profile')), await realpath(dbPath))
    expect(relativePath).not.toBe('')
    expect(relativePath.startsWith('..')).toBe(false)
    expect(isAbsolute(relativePath)).toBe(false)

    db = new DatabaseSync(dbPath)
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`INSERT INTO file_entry
        (id, origin, name, ext, size, cleanup_policy, created_at, updated_at, deleted_at, external_path, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        ids.entryId,
        'internal',
        name,
        'png',
        0,
        'delete_when_unreferenced',
        now,
        now,
        now,
        null,
        null
      )
      db.prepare(`INSERT INTO job
        (id, type, status, queue, scheduled_at, created_at, updated_at, finished_at, input,
         priority, attempt, max_attempts, cancel_requested, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        ids.jobId,
        'image-generation.generate',
        'completed',
        `archive-holder-${ids.jobId}`,
        now,
        now,
        now,
        now,
        '{}',
        0,
        0,
        3,
        0,
        '{}'
      )
      db.prepare(`INSERT INTO job_file_ref (id, file_entry_id, source_id, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(ids.refId, ids.entryId, ids.jobId, 'input', now, now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-ui~="settings.navigation"]').getByRole('button', { name: 'Archive', exact: true }).click()
    await page.getByRole('tab', { name: 'Files', exact: true }).click()
    const row = page.locator('[data-slot="item"]').filter({ has: page.getByText(`${name}.png`, { exact: true }) })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Delete Permanently', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: 'Delete permanently?', exact: true })
    await expect(
      dialog.getByText(
        '1 file is still used by 1 record and will be kept. Remove that reference before deleting permanently.',
        { exact: true }
      )
    ).toBeVisible()
    await expect(
      dialog.getByText(`Image-generation job record ${ids.jobId} (input image)`, { exact: true })
    ).toBeVisible()
    await expect(dialog.getByText(RELEASE, { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Delete Permanently', exact: true })).toBeDisabled()
    await page.bringToFront()
    await page.waitForTimeout(300)
    await testInfo.attach('archive-holder-dialog-before-cancel', {
      body: await page.screenshot(),
      contentType: 'image/png'
    })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(row).toBeVisible()
    await page.bringToFront()
    await page.waitForTimeout(300)
    await testInfo.attach('archive-holder-after-cancel', { body: await page.screenshot(), contentType: 'image/png' })

    const counts = {
      entry: db.prepare('SELECT count(*) AS count FROM file_entry WHERE id = ?').get(ids.entryId)?.count,
      job: db.prepare('SELECT count(*) AS count FROM job WHERE id = ?').get(ids.jobId)?.count,
      ref: db
        .prepare('SELECT count(*) AS count FROM job_file_ref WHERE id = ? AND file_entry_id = ? AND source_id = ?')
        .get(ids.refId, ids.entryId, ids.jobId)?.count
    }
    await testInfo.attach('archive-holder-preservation', {
      body: JSON.stringify({ ids, name, counts }, null, 2),
      contentType: 'application/json'
    })
    expect(counts).toEqual({ entry: 1, job: 1, ref: 1 })
  } finally {
    try {
      if (db) {
        try {
          db.exec('BEGIN IMMEDIATE')
          try {
            db.prepare('DELETE FROM job WHERE id = ?').run(ids.jobId)
            db.prepare('DELETE FROM file_entry WHERE id = ?').run(ids.entryId)
            db.exec('COMMIT')
          } catch (error) {
            db.exec('ROLLBACK')
            throw error
          }
        } finally {
          db.close()
        }
      }
    } finally {
      await page.evaluate(async (values) => {
        await window.api.preference.set('app.language', values.language)
        await window.api.preference.set('app.onboarding.provider_setup.status', values.onboarding)
        await window.api.preference.set('app.privacy.policy_version', values.privacyVersion)
      }, previous)
    }
  }
})
