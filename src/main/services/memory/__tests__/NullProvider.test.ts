/**
 * Unit tests for NullProvider.
 */
import { describe, expect, it } from 'vitest'

import { NullProvider } from '../providers/NullProvider'

describe('NullProvider', () => {
  const provider = new NullProvider()

  it('has id "off"', () => {
    expect(provider.id).toBe('off')
  })

  it('healthCheck returns false', async () => {
    expect(await provider.healthCheck()).toBe(false)
  })

  it('listUsers returns empty array', async () => {
    expect(await provider.listUsers()).toEqual([])
  })

  it('add throws PROVIDER_DISABLED', async () => {
    await expect(provider.add('test')).rejects.toThrow('disabled')
  })

  it('search throws PROVIDER_DISABLED', async () => {
    await expect(provider.search('query')).rejects.toThrow('disabled')
  })

  it('list throws PROVIDER_DISABLED', async () => {
    await expect(provider.list()).rejects.toThrow('disabled')
  })

  it('reflect is not defined', () => {
    expect((provider as any).reflect).toBeUndefined()
  })

  it('capabilities.serverSideExtraction is false', () => {
    expect(provider.capabilities.serverSideExtraction).toBe(false)
  })
})
