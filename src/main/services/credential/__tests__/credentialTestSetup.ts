import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'

import { CredentialStoreService } from '../CredentialStoreService'

export function setupCredentialStore() {
  const dbh = setupTestDatabase()
  let directory: string
  let store: CredentialStoreService
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'cherry-credential-'))
    vi.mocked(application.getPath).mockImplementation((key, filename) => {
      if (key === 'feature.credentials') return filename ? path.join(directory, filename) : directory
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    BaseService.resetInstances()
    store = new CredentialStoreService()
    await store._doInit()
  })
  afterEach(async () => {
    await store?._doStop()
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })
  return {
    dbh,
    get store() {
      return store
    },
    get directory() {
      return directory
    }
  }
}

export const applicationInput = {
  connector: 'feishu' as const,
  kind: 'application' as const,
  label: 'Shared app',
  payload: {
    domain: 'feishu' as const,
    appId: 'cli_example',
    appSecret: 'secret-sentinel',
    encryptKey: 'encrypt-sentinel',
    verificationToken: 'verify-sentinel'
  }
}
export const tokens = {
  accessToken: 'access-sentinel',
  refreshToken: 'refresh-sentinel',
  accessTokenExpiresAt: 1000,
  refreshTokenExpiresAt: 2000,
  grantedScopes: ['wiki:node:read', 'offline_access']
}
