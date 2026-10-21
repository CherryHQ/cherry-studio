import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applicationInput, setupCredentialStore } from '@data/credential/__tests__/credentialTestSetup'
import type { CredentialStoreService } from '@data/credential/CredentialStoreService'
import { credentialErrorCodes } from '@shared/ipc/errors/credential'
import { credentialRequestSchemas } from '@shared/ipc/schemas/credential'
import { CredentialSummarySchema } from '@shared/types/credential'

const storeMethods = vi.hoisted(() => ({
  create: vi.fn<CredentialStoreService['create']>(),
  listSummaries: vi.fn<CredentialStoreService['listSummaries']>(),
  replaceApplication: vi.fn<CredentialStoreService['replaceApplication']>()
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
    await expect(
      router.dispatch('credential.feishu.replace_application', { id: '../escape', appSecret: 'new' }, ctx)
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED'
    })
    expect(await fixture.store.listSummaries()).toEqual([])
  })

  it('returns a conflict without secret detail', async () => {
    await fixture.store.create(applicationInput)
    await expect(
      router.dispatch(
        'credential.feishu.create_application',
        { label: 'Other', ...applicationInput.payload, appSecret: 'different-secret' },
        ctx
      )
    ).rejects.toMatchObject({ code: credentialErrorCodes.CONFLICT, message: credentialErrorCodes.CONFLICT })
  })

  it('does not serialize unexpected internal error messages', async () => {
    storeMethods.listSummaries.mockRejectedValueOnce(new Error('provider payload secret-sentinel'))
    await expect(router.dispatch('credential.list', {}, ctx)).rejects.toMatchObject({
      code: credentialErrorCodes.UNAVAILABLE,
      message: credentialErrorCodes.UNAVAILABLE
    })
  })
})
