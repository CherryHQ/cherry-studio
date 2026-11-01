import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import * as file from '@main/utils/file'

import { applicationInput, setupCredentialStore, tokens } from './credentialTestSetup'

describe('CredentialStoreService', () => {
  const fixture = setupCredentialStore()
  const createApplication = () => fixture.store.create(applicationInput)
  const createGrant = async () => {
    const app = await createApplication()
    const grant = await fixture.store.create({
      connector: 'feishu',
      kind: 'user-authorization',
      label: 'Account',
      payload: { applicationCredentialId: app.id, tokens }
    })
    return {
      app,
      grant,
      expected: {
        applicationCredentialId: app.id,
        application: applicationInput.payload,
        refreshToken: tokens.refreshToken
      }
    }
  }

  it('persists plaintext records across restart while exposing only safe summaries', async () => {
    const { grant } = await createGrant()
    const contents = await readFile(path.join(fixture.directory, `${grant.id}.json`), 'utf8')
    expect(contents).toContain('refresh-sentinel')
    expect(JSON.parse(contents)).not.toHaveProperty('formatVersion')
    await fixture.store._doStop()
    await fixture.store._doInit()
    expect(await fixture.store.read(grant.id)).toMatchObject({ status: 'ok', record: { payload: { tokens } } })
    const summaries = await fixture.store.listSummaries()
    expect(summaries).toHaveLength(2)
    for (const secret of [
      'secret-sentinel',
      'encrypt-sentinel',
      'verify-sentinel',
      'access-sentinel',
      'refresh-sentinel'
    ])
      expect(JSON.stringify(summaries)).not.toContain(secret)
    expect((await readdir(fixture.directory)).filter((name) => !name.endsWith('.json'))).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('repairs directory and file permissions on restart', async () => {
    const app = await createApplication()
    await chmod(fixture.directory, 0o755)
    await chmod(path.join(fixture.directory, `${app.id}.json`), 0o644)
    await fixture.store._doStop()
    await fixture.store._doInit()
    expect((await stat(fixture.directory)).mode & 0o777).toBe(0o700)
    expect((await stat(path.join(fixture.directory, `${app.id}.json`))).mode & 0o777).toBe(0o600)
  })

  it('deduplicates identical applications but refuses conflicting secrets without altering either file', async () => {
    const app = await createApplication()
    expect((await createApplication()).id).toBe(app.id)
    await expect(
      fixture.store.create({ ...applicationInput, payload: { ...applicationInput.payload, appSecret: 'different' } })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await readdir(fixture.directory)).toEqual([`${app.id}.json`])
    expect(await fixture.store.read(app.id)).toMatchObject({
      status: 'ok',
      record: { payload: applicationInput.payload }
    })
  })

  it('preserves corrupt records and does not mistake them for an empty store', async () => {
    const app = await createApplication()
    const target = path.join(fixture.directory, `${app.id}.json`)
    await writeFile(target, '{broken-secret-sentinel')
    expect(await fixture.store.read(app.id)).toEqual({ status: 'corrupt' })
    expect(await fixture.store.listSummaries()).toEqual([{ id: app.id, status: 'corrupt' }])
    await expect(fixture.store.replaceApplication({ id: app.id, appSecret: 'new' })).rejects.toMatchObject({
      code: 'corrupt'
    })
    await expect(createApplication()).rejects.toMatchObject({ code: 'corrupt' })
    await expect(fixture.store.remove(app.id, () => false)).rejects.toMatchObject({ code: 'corrupt' })
    expect(await readFile(target, 'utf8')).toBe('{broken-secret-sentinel')
  })

  it('refuses mismatched file identity and unknown persisted fields', async () => {
    const app = await createApplication()
    const target = path.join(fixture.directory, `${app.id}.json`)
    await writeFile(target, JSON.stringify({ ...applicationInput, id: randomUUID() }))
    expect(await fixture.store.read(app.id)).toEqual({ status: 'corrupt' })
    await writeFile(target, JSON.stringify({ ...applicationInput, id: app.id, formatVersion: 1 }))
    expect(await fixture.store.read(app.id)).toEqual({ status: 'corrupt' })
  })

  it('rejects traversal and malformed payload before writing outside the store', async () => {
    await expect(async () => fixture.store.create(applicationInput, '../escape')).rejects.toMatchObject({
      code: 'invalid'
    })
    await expect(async () => fixture.store.read('../escape')).rejects.toMatchObject({ code: 'invalid' })
    await expect(async () =>
      fixture.store.create({ ...applicationInput, payload: { ...applicationInput.payload, appSecret: '' } })
    ).rejects.toMatchObject({ code: 'invalid' })
    expect(await readdir(fixture.directory)).toEqual([])
  })

  it('leaves the last valid record intact on write failure and allows the next queued write', async () => {
    const app = await createApplication()
    const writer = vi.spyOn(file, 'atomicWriteFile').mockRejectedValueOnce(new Error('sensitive-disk-error'))
    await expect(fixture.store.replaceApplication({ id: app.id, appSecret: 'failed' })).rejects.toMatchObject({
      code: 'write-failed',
      message: 'Credential operation failed: write-failed'
    })
    expect(await fixture.store.read(app.id)).toMatchObject({
      status: 'ok',
      record: { payload: applicationInput.payload }
    })
    writer.mockRestore()
    await fixture.store.replaceApplication({ id: app.id, appSecret: 'next' })
    expect(await fixture.store.read(app.id)).toMatchObject({ status: 'ok', record: { payload: { appSecret: 'next' } } })
  })

  it('rotates a token once and rejects an old response after token or application replacement', async () => {
    const { app, grant, expected } = await createGrant()
    const rotated = { ...tokens, accessToken: 'next-access', refreshToken: 'next-refresh' }
    expect(
      await Promise.all([
        fixture.store.rotateTokens(grant.id, expected, rotated),
        fixture.store.rotateTokens(grant.id, expected, { ...tokens, refreshToken: 'stale' })
      ])
    ).toEqual(['updated', 'stale'])
    await fixture.store.replaceApplication({ id: app.id, appSecret: 'replaced' })
    expect(
      await fixture.store.rotateTokens(grant.id, { ...expected, refreshToken: rotated.refreshToken }, tokens)
    ).toBe('stale')
    expect(await fixture.store.read(grant.id)).toMatchObject({ status: 'ok', record: { payload: { tokens: rotated } } })
  })

  it('never resurrects a deleted grant when refresh finishes later', async () => {
    const { grant, expected } = await createGrant()
    expect(await fixture.store.remove(grant.id, () => false)).toBe('removed')
    expect(await fixture.store.rotateTokens(grant.id, expected, tokens)).toBe('missing')
    expect(await fixture.store.read(grant.id)).toEqual({ status: 'missing' })
  })

  it('preserves omitted optional secrets and clears them only explicitly', async () => {
    const app = await createApplication()
    await fixture.store.replaceApplication({ id: app.id, appSecret: 'replacement' })
    expect(await fixture.store.read(app.id)).toMatchObject({
      status: 'ok',
      record: { payload: { encryptKey: 'encrypt-sentinel', verificationToken: 'verify-sentinel' } }
    })
    await fixture.store.replaceApplication({ id: app.id, encryptKey: null })
    const result = await fixture.store.read(app.id)
    expect(result.status === 'ok' && result.record.payload).not.toHaveProperty('encryptKey')
  })

  it('distinguishes pending grants from grants bound to missing or wrong-kind applications', async () => {
    const app = await createApplication()
    const pending = await fixture.store.create({
      connector: 'feishu',
      kind: 'user-authorization',
      label: 'Pending',
      payload: { applicationCredentialId: app.id, tokens: null }
    })
    expect(await fixture.store.read(pending.id)).toMatchObject({ status: 'ok', record: { payload: { tokens: null } } })
    await expect(
      fixture.store.create({
        connector: 'feishu',
        kind: 'user-authorization',
        label: 'Wrong',
        payload: { applicationCredentialId: pending.id, tokens: null }
      })
    ).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      fixture.store.create({
        connector: 'feishu',
        kind: 'user-authorization',
        label: 'Missing',
        payload: { applicationCredentialId: randomUUID(), tokens: null }
      })
    ).rejects.toMatchObject({ code: 'missing' })
  })

  it('finishes accepted writes on stop, refuses new work and renews subscriptions on restart', async () => {
    const app = await createApplication()
    const changes: unknown[] = []
    fixture.store.onDidChange((change) => changes.push(change))
    const write = fixture.store.replaceApplication({ id: app.id, appSecret: 'shutdown-secret' })
    const stopped = fixture.store._doStop()
    await expect(fixture.store.listSummaries()).rejects.toMatchObject({ code: 'stopped' })
    await write
    await stopped
    expect(changes).toEqual([{ id: app.id, kind: 'application', operation: 'replaced' }])
    await fixture.store._doInit()
    const next: unknown[] = []
    fixture.store.onDidChange((change) => next.push(change))
    await fixture.store.replaceApplication({ id: app.id, appSecret: 'restart-secret' })
    expect(changes).toHaveLength(1)
    expect(next).toEqual([{ id: app.id, kind: 'application', operation: 'replaced' }])
  })

  it('rejects a non-file record instead of deleting it', async () => {
    const id = randomUUID()
    await mkdir(path.join(fixture.directory, `${id}.json`))
    await expect(fixture.store.remove(id, () => false)).rejects.toMatchObject({ code: 'corrupt' })
    expect((await stat(path.join(fixture.directory, `${id}.json`))).isDirectory()).toBe(true)
  })
  it('checks business usage after an earlier queued binding and preserves its credential', async () => {
    const app = await createApplication()
    let reference: string | undefined
    const binding = fixture.store.withReferences([app.id], ([record]) => {
      reference = record.id
    })
    const deletion = fixture.store.remove(app.id, (id) => reference === id)
    await binding
    await expect(deletion).rejects.toMatchObject({ code: 'in-use' })
    expect(reference).toBe(app.id)
    expect(await fixture.store.read(app.id)).toMatchObject({ status: 'ok' })
  })

  it('rejects a binding queued after removal without publishing a dangling reference', async () => {
    const app = await createApplication()
    let reference: string | undefined
    const deletion = fixture.store.remove(app.id, (id) => reference === id)
    const binding = fixture.store.withReferences([app.id], ([record]) => {
      reference = record.id
    })
    expect(await deletion).toBe('removed')
    await expect(binding).rejects.toMatchObject({ code: 'missing' })
    expect(reference).toBeUndefined()
  })

  it('preserves an application while a user authorization refers to it', async () => {
    const { app, grant } = await createGrant()
    await expect(fixture.store.remove(app.id, () => false)).rejects.toMatchObject({ code: 'in-use' })
    expect(await fixture.store.read(app.id)).toMatchObject({ status: 'ok' })
    expect(await fixture.store.read(grant.id)).toMatchObject({ status: 'ok' })
  })

  it('preserves the credential if business usage cannot be determined', async () => {
    const app = await createApplication()
    await expect(
      fixture.store.remove(app.id, () => {
        throw new Error('usage unavailable')
      })
    ).rejects.toThrow('usage unavailable')
    expect(await fixture.store.read(app.id)).toMatchObject({ status: 'ok' })
  })
})
