import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, loggerMock, settingsWindowServiceMock } = vi.hoisted(() => {
  const settingsWindowServiceMock = {
    openUsingPreference: vi.fn()
  }
  const loggerMock = {
    debug: vi.fn(),
    error: vi.fn()
  }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'SettingsWindowService') return settingsWindowServiceMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  return { applicationMock, loggerMock, settingsWindowServiceMock }
})

vi.mock('@application', () => ({ application: applicationMock }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

import { handleProvidersProtocolUrl, parseProvidersImportData } from '../providersImport'

const toUrlSafeBase64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value), 'utf-8').toString('base64').replaceAll('+', '_').replaceAll('/', '-')

describe('providersImport protocol handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens provider settings with decoded provider import data', async () => {
    const config = {
      id: 'tokenflux',
      baseUrl: 'https://tokenflux.ai/v1',
      apiKey: 'sk-test',
      name: 'TokenFlux',
      type: 'openai'
    }
    const data = toUrlSafeBase64(config)

    await handleProvidersProtocolUrl(new URL(`cherrystudio://providers/api-keys?v=1&data=${data}`))

    expect(settingsWindowServiceMock.openUsingPreference).toHaveBeenCalledWith(
      `/settings/provider?addProviderData=${encodeURIComponent(JSON.stringify(config))}`
    )
  })

  it('does not open settings when provider import data is invalid', async () => {
    await handleProvidersProtocolUrl(new URL('cherrystudio://providers/api-keys?v=1&data=not-json'))

    expect(settingsWindowServiceMock.openUsingPreference).not.toHaveBeenCalled()
    expect(loggerMock.error).toHaveBeenCalled()
  })

  it('preserves standard base64 plus and slash characters through URL parsing', async () => {
    const config = { id: 'tokenflux', apiKey: 'sk-10895-Ͽ' }
    const data = Buffer.from(JSON.stringify(config), 'utf-8').toString('base64')

    expect(data).toContain('+')
    expect(data).toContain('/')

    await handleProvidersProtocolUrl(new URL(`cherrystudio://providers/api-keys?v=1&data=${data}`))

    expect(settingsWindowServiceMock.openUsingPreference).toHaveBeenCalledWith(
      `/settings/provider?addProviderData=${encodeURIComponent(JSON.stringify(config))}`
    )
  })

  it('parses wrapped legacy provider import payloads', () => {
    const payload = Buffer.from("({'id':'tokenflux'})", 'utf-8').toString('base64')

    expect(parseProvidersImportData(payload)).toBe(JSON.stringify({ id: 'tokenflux' }))
  })
})
