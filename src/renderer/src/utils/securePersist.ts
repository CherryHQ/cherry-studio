import { decryptSecretWithIssue, encryptSecret } from './secureStorage'

export const SECURE_PERSIST_SLICE_KEYS = ['llm', 'settings', 'preprocess', 'websearch', 'nutstore'] as const
export type SecurePersistSliceKey = (typeof SECURE_PERSIST_SLICE_KEYS)[number]

type TransformSecret = (value: string, context?: { id: string; meta?: Record<string, unknown> }) => string

const transformProvidersApiKeys = (sliceKey: string, state: any, transformSecret: TransformSecret) => {
  return {
    ...state,
    providers: Array.isArray(state.providers)
      ? state.providers.map((provider: any, index: number) => {
          const providerId = typeof provider.id === 'string' ? provider.id : String(index)
          return {
            ...provider,
            apiKey:
              typeof provider.apiKey === 'string'
                ? transformSecret(provider.apiKey, {
                    id: `${sliceKey}.providers.${providerId}.apiKey`,
                    meta:
                      typeof provider.id === 'string'
                        ? { scope: sliceKey, providerId: provider.id }
                        : { scope: sliceKey }
                  })
                : provider.apiKey
          }
        })
      : state.providers
  }
}

export const transformPersistSliceState = (key: string, state: any, transformSecret: TransformSecret) => {
  if (!state || typeof state !== 'object') {
    return state
  }

  if (key === 'llm') {
    return {
      ...transformProvidersApiKeys('llm', state, transformSecret),
      settings: {
        ...state.settings,
        vertexai: state.settings?.vertexai
          ? {
              ...state.settings.vertexai,
              serviceAccount: state.settings.vertexai.serviceAccount
                ? {
                    ...state.settings.vertexai.serviceAccount,
                    privateKey:
                      typeof state.settings.vertexai.serviceAccount.privateKey === 'string'
                        ? transformSecret(state.settings.vertexai.serviceAccount.privateKey, {
                            id: 'llm.settings.vertexai.serviceAccount.privateKey',
                            meta: { scope: 'llm', providerId: 'vertexai' }
                          })
                        : state.settings.vertexai.serviceAccount.privateKey
                  }
                : state.settings.vertexai.serviceAccount
            }
          : state.settings?.vertexai,
        awsBedrock: state.settings?.awsBedrock
          ? {
              ...state.settings.awsBedrock,
              accessKeyId:
                typeof state.settings.awsBedrock.accessKeyId === 'string'
                  ? transformSecret(state.settings.awsBedrock.accessKeyId, {
                      id: 'llm.settings.awsBedrock.accessKeyId',
                      meta: { scope: 'llm', providerId: 'awsBedrock' }
                    })
                  : state.settings.awsBedrock.accessKeyId,
              secretAccessKey:
                typeof state.settings.awsBedrock.secretAccessKey === 'string'
                  ? transformSecret(state.settings.awsBedrock.secretAccessKey, {
                      id: 'llm.settings.awsBedrock.secretAccessKey',
                      meta: { scope: 'llm', providerId: 'awsBedrock' }
                    })
                  : state.settings.awsBedrock.secretAccessKey,
              apiKey:
                typeof state.settings.awsBedrock.apiKey === 'string'
                  ? transformSecret(state.settings.awsBedrock.apiKey, {
                      id: 'llm.settings.awsBedrock.apiKey',
                      meta: { scope: 'llm', providerId: 'awsBedrock' }
                    })
                  : state.settings.awsBedrock.apiKey
            }
          : state.settings?.awsBedrock
      }
    }
  }

  if (key === 'settings') {
    return {
      ...state,
      webdavPass:
        typeof state.webdavPass === 'string'
          ? transformSecret(state.webdavPass, { id: 'settings.webdavPass', meta: { scope: 'settings' } })
          : state.webdavPass,
      notionApiKey:
        typeof state.notionApiKey === 'string'
          ? transformSecret(state.notionApiKey, { id: 'settings.notionApiKey', meta: { scope: 'settings' } })
          : state.notionApiKey,
      yuqueToken:
        typeof state.yuqueToken === 'string'
          ? transformSecret(state.yuqueToken, { id: 'settings.yuqueToken', meta: { scope: 'settings' } })
          : state.yuqueToken,
      joplinToken:
        typeof state.joplinToken === 'string'
          ? transformSecret(state.joplinToken, { id: 'settings.joplinToken', meta: { scope: 'settings' } })
          : state.joplinToken,
      siyuanToken:
        typeof state.siyuanToken === 'string'
          ? transformSecret(state.siyuanToken, { id: 'settings.siyuanToken', meta: { scope: 'settings' } })
          : state.siyuanToken,
      s3: state.s3
        ? {
            ...state.s3,
            accessKeyId:
              typeof state.s3.accessKeyId === 'string'
                ? transformSecret(state.s3.accessKeyId, { id: 'settings.s3.accessKeyId', meta: { scope: 'settings' } })
                : state.s3.accessKeyId,
            secretAccessKey:
              typeof state.s3.secretAccessKey === 'string'
                ? transformSecret(state.s3.secretAccessKey, {
                    id: 'settings.s3.secretAccessKey',
                    meta: { scope: 'settings' }
                  })
                : state.s3.secretAccessKey
          }
        : state.s3,
      apiServer: state.apiServer
        ? {
            ...state.apiServer,
            apiKey:
              typeof state.apiServer.apiKey === 'string'
                ? transformSecret(state.apiServer.apiKey, {
                    id: 'settings.apiServer.apiKey',
                    meta: { scope: 'settings' }
                  })
                : state.apiServer.apiKey
          }
        : state.apiServer
    }
  }

  if (key === 'preprocess' || key === 'websearch') {
    return transformProvidersApiKeys(key, state, transformSecret)
  }

  if (key === 'nutstore') {
    return {
      ...state,
      nutstoreToken:
        typeof state.nutstoreToken === 'string'
          ? transformSecret(state.nutstoreToken, { id: 'nutstore.nutstoreToken', meta: { scope: 'nutstore' } })
          : state.nutstoreToken
    }
  }

  return state
}

const encryptSecretTransform: TransformSecret = (value) => encryptSecret(value)
const decryptSecretTransform: TransformSecret = (value, context) =>
  decryptSecretWithIssue(value, context?.id, context?.meta)

export const encryptPersistSliceState = (key: string, state: any) =>
  transformPersistSliceState(key, state, encryptSecretTransform)
export const decryptPersistSliceState = (key: string, state: any) =>
  transformPersistSliceState(key, state, decryptSecretTransform)
export const stripPersistSliceSecrets = (key: string, state: any) => transformPersistSliceState(key, state, () => '')

export type PersistedRootState = Record<string, unknown>

export const transformPersistedRootStateString = (persistedValue: string, direction: 'encrypt' | 'decrypt'): string => {
  const transformSlice = direction === 'encrypt' ? encryptPersistSliceState : decryptPersistSliceState

  try {
    const root = JSON.parse(persistedValue) as PersistedRootState
    if (!root || typeof root !== 'object') {
      return persistedValue
    }

    let changed = false
    for (const sliceKey of SECURE_PERSIST_SLICE_KEYS) {
      const rawSlice = root[sliceKey]
      if (typeof rawSlice !== 'string') {
        continue
      }

      try {
        const parsedSlice = JSON.parse(rawSlice)
        const transformedSlice = transformSlice(sliceKey, parsedSlice)
        const nextRawSlice = JSON.stringify(transformedSlice)
        if (nextRawSlice !== rawSlice) {
          root[sliceKey] = nextRawSlice
          changed = true
        }
      } catch {
        // Ignore malformed slice payloads and keep original.
      }
    }

    return changed ? JSON.stringify(root) : persistedValue
  } catch {
    return persistedValue
  }
}

export const stripPersistedRootStateSecretsString = (persistedValue: string): string => {
  try {
    const root = JSON.parse(persistedValue) as PersistedRootState
    if (!root || typeof root !== 'object') {
      return persistedValue
    }

    let changed = false
    for (const sliceKey of SECURE_PERSIST_SLICE_KEYS) {
      const rawSlice = root[sliceKey]
      if (typeof rawSlice !== 'string') {
        continue
      }

      try {
        const parsedSlice = JSON.parse(rawSlice)
        const strippedSlice = stripPersistSliceSecrets(sliceKey, parsedSlice)
        const nextRawSlice = JSON.stringify(strippedSlice)
        if (nextRawSlice !== rawSlice) {
          root[sliceKey] = nextRawSlice
          changed = true
        }
      } catch {
        // Ignore malformed slice payloads and keep original.
      }
    }

    return changed ? JSON.stringify(root) : persistedValue
  } catch {
    return persistedValue
  }
}
