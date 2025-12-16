import { beforeEach, describe, expect, it, vi } from 'vitest'

import { stripPersistedRootStateSecretsString, transformPersistedRootStateString } from '../securePersist'
import { decryptSecret, encryptSecret } from '../secureStorage'

describe('securePersist', () => {
  beforeEach(() => {
    const safeStorage = {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((plainText: string) => {
        if (plainText.startsWith('csenc:')) return plainText
        return `csenc:${Buffer.from(plainText, 'utf-8').toString('base64')}`
      }),
      decryptString: vi.fn((value: string) => {
        const prefix = 'csenc:'
        if (!value.startsWith(prefix)) return value
        try {
          return Buffer.from(value.slice(prefix.length), 'base64').toString('utf-8')
        } catch {
          return value
        }
      })
    }

    ;(window as any).api = { ...(window as any).api, safeStorage }
  })

  it('decrypts persisted secrets to plaintext for portability', () => {
    const persisted = JSON.stringify({
      llm: JSON.stringify({
        providers: [{ id: 'p1', apiKey: encryptSecret('k1') }],
        settings: {
          awsBedrock: {
            accessKeyId: encryptSecret('ak'),
            secretAccessKey: encryptSecret('sk'),
            apiKey: encryptSecret('bk')
          },
          vertexai: {
            serviceAccount: {
              privateKey: encryptSecret('pk')
            }
          }
        }
      }),
      settings: JSON.stringify({
        webdavPass: encryptSecret('pass'),
        s3: { accessKeyId: encryptSecret('s3ak'), secretAccessKey: encryptSecret('s3sk') },
        apiServer: { apiKey: encryptSecret('api') }
      }),
      preprocess: JSON.stringify({ providers: [{ apiKey: encryptSecret('pre') }] }),
      websearch: JSON.stringify({ providers: [{ apiKey: encryptSecret('ws') }] }),
      nutstore: JSON.stringify({ nutstoreToken: encryptSecret('nut') }),
      _persist: JSON.stringify({ version: 183, rehydrated: true })
    })

    const decrypted = transformPersistedRootStateString(persisted, 'decrypt')
    const root = JSON.parse(decrypted) as Record<string, string>

    const llm = JSON.parse(root.llm)
    expect(llm.providers[0].apiKey).toBe('k1')
    expect(llm.settings.awsBedrock.accessKeyId).toBe('ak')
    expect(llm.settings.awsBedrock.secretAccessKey).toBe('sk')
    expect(llm.settings.awsBedrock.apiKey).toBe('bk')
    expect(llm.settings.vertexai.serviceAccount.privateKey).toBe('pk')

    const settings = JSON.parse(root.settings)
    expect(settings.webdavPass).toBe('pass')
    expect(settings.s3.accessKeyId).toBe('s3ak')
    expect(settings.s3.secretAccessKey).toBe('s3sk')
    expect(settings.apiServer.apiKey).toBe('api')

    const preprocess = JSON.parse(root.preprocess)
    expect(preprocess.providers[0].apiKey).toBe('pre')

    const websearch = JSON.parse(root.websearch)
    expect(websearch.providers[0].apiKey).toBe('ws')

    const nutstore = JSON.parse(root.nutstore)
    expect(nutstore.nutstoreToken).toBe('nut')
  })

  it('re-encrypts plaintext secrets for the current device', () => {
    const plaintext = JSON.stringify({
      llm: JSON.stringify({ providers: [{ apiKey: 'k1' }], settings: { awsBedrock: { accessKeyId: 'ak' } } }),
      settings: JSON.stringify({ webdavPass: 'pass' }),
      _persist: JSON.stringify({ version: 183, rehydrated: true })
    })

    const encrypted = transformPersistedRootStateString(plaintext, 'encrypt')
    const root = JSON.parse(encrypted) as Record<string, string>
    const llm = JSON.parse(root.llm)
    const settings = JSON.parse(root.settings)

    expect(typeof llm.providers[0].apiKey).toBe('string')
    expect(llm.providers[0].apiKey.startsWith('csenc:')).toBe(true)
    expect(decryptSecret(llm.providers[0].apiKey)).toBe('k1')

    expect(typeof settings.webdavPass).toBe('string')
    expect(settings.webdavPass.startsWith('csenc:')).toBe(true)
    expect(decryptSecret(settings.webdavPass)).toBe('pass')
  })

  it('clears encrypted secrets when decryption fails', () => {
    ;(window as any).api.safeStorage.decryptString = vi.fn((value: string) => value)

    const encrypted = JSON.stringify({
      settings: JSON.stringify({ webdavPass: encryptSecret('pass') }),
      _persist: JSON.stringify({ version: 183, rehydrated: true })
    })

    const decrypted = transformPersistedRootStateString(encrypted, 'decrypt')
    const root = JSON.parse(decrypted) as Record<string, string>
    const settings = JSON.parse(root.settings)
    expect(settings.webdavPass).toBe('')
  })

  it('strips secrets without requiring decryption', () => {
    const persisted = JSON.stringify({
      llm: JSON.stringify({
        providers: [{ id: 'p1', apiKey: encryptSecret('k1') }],
        settings: { awsBedrock: { secretAccessKey: encryptSecret('sk') } }
      }),
      settings: JSON.stringify({ webdavPass: encryptSecret('pass'), yuqueToken: 'keep-non-encrypted?' }),
      _persist: JSON.stringify({ version: 183, rehydrated: true })
    })

    const stripped = stripPersistedRootStateSecretsString(persisted)
    const root = JSON.parse(stripped) as Record<string, string>
    const llm = JSON.parse(root.llm)
    const settings = JSON.parse(root.settings)

    expect(llm.providers[0].apiKey).toBe('')
    expect(llm.settings.awsBedrock.secretAccessKey).toBe('')
    expect(settings.webdavPass).toBe('')
    expect(settings.yuqueToken).toBe('')
  })
})
