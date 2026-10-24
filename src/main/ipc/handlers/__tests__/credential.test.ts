import { randomUUID } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CredentialStoreService } from '@main/services/credential'
import { applicationInput, setupCredentialStore } from '@main/services/credential/__tests__/credentialTestSetup'
import { credentialErrorCodes } from '@shared/ipc/errors/credential'
import { credentialRequestSchemas } from '@shared/ipc/schemas/credential'
import { CredentialSummarySchema } from '@shared/types/credential'

const storeMethods = vi.hoisted(() => ({
  create: vi.fn<CredentialStoreService['create']>(),
  listSummaries: vi.fn<CredentialStoreService['listSummaries']>(),
  replaceApplication: vi.fn<CredentialStoreService['replaceApplication']>(),
  remove: vi.fn<CredentialStoreService['remove']>()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const overrides = { ...defaultServiceInstances, CredentialStoreService: storeMethods }
  return mockApplicationFactory(overrides)
})

import { IpcRouter } from '../../IpcRouter'
import { credentialHandlers } from '../credential'

describe('Credential IPC', () => {
  const fixture = setupCredentialStore()
  const router = new IpcRouter(credentialRequestSchemas, credentialHandlers)
  const ctx = { senderId: 'main-window' }
  beforeEach(() => {
    storeMethods.create.mockImplementation((...args) => fixture.store.create(...args))
    storeMethods.listSummaries.mockImplementation((...args) => fixture.store.listSummaries(...args))
    storeMethods.replaceApplication.mockImplementation((...args) => fixture.store.replaceApplication(...args))
    storeMethods.remove.mockImplementation((...args) => fixture.store.remove(...args))
  })

  it('accepts manual secrets but never returns them through create, replace or list', async () => {
    const input = { label: applicationInput.label, ...applicationInput.payload }
    const created = await router.dispatch('credential.feishu.create_application', input, ctx)
    const app = CredentialSummarySchema.parse(created)
    const replaced = await router.dispatch(
      'credential.feishu.replace_application',
      { id: app.id, appSecret: 'new-secret' },
      ctx
    )
    const listed = await router.dispatch('credential.list', {}, ctx)
    for (const value of [created, replaced, listed]) {
      for (const secret of ['secret-sentinel', 'encrypt-sentinel', 'verify-sentinel', 'new-secret'])
        expect(JSON.stringify(value)).not.toContain(secret)
    }
    expect(await fixture.store.read(app.id)).toMatchObject({
      status: 'ok',
      record: { payload: { appSecret: 'new-secret' } }
    })
    await expect(router.dispatch('credential.read', { id: app.id }, ctx)).rejects.toMatchObject({
      code: 'ROUTE_NOT_FOUND'
    })
  })

  it('rejects extra fields and invalid references at the router boundary', async () => {
    await expect(
      router.dispatch(
        'credential.feishu.create_application',
        { label: 'App', ...applicationInput.payload, formatVersion: 1 },
        ctx
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(router.dispatch('credential.remove', { id: '../escape' }, ctx)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED'
    })
    expect(await fixture.store.listSummaries()).toEqual([])
  })

  it('returns actionable conflict and in-use errors without secret detail', async () => {
    const app = await fixture.store.create(applicationInput)
    await fixture.store.create({
      connector: 'feishu',
      kind: 'user-authorization',
      label: 'Account',
      payload: { applicationCredentialId: app.id, tokens: null }
    })
    await expect(router.dispatch('credential.remove', { id: app.id }, ctx)).rejects.toMatchObject({
      code: credentialErrorCodes.IN_USE
    })
    await expect(
      router.dispatch(
        'credential.feishu.create_application',
        { label: 'Other', ...applicationInput.payload, appSecret: 'different-secret' },
        ctx
      )
    ).rejects.toMatchObject({ code: credentialErrorCodes.CONFLICT, message: credentialErrorCodes.CONFLICT })
    expect(await router.dispatch('credential.remove', { id: randomUUID() }, ctx)).toBe('missing')
  })

  it('does not serialize unexpected internal error messages', async () => {
    storeMethods.listSummaries.mockRejectedValueOnce(new Error('provider payload secret-sentinel'))
    await expect(router.dispatch('credential.list', {}, ctx)).rejects.toMatchObject({
      code: credentialErrorCodes.UNAVAILABLE,
      message: credentialErrorCodes.UNAVAILABLE
    })
  })
})
