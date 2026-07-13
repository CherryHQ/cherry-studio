import { describe, expect, it } from 'vitest'

import { recoverV1ProviderLogoIconKey } from '../providerLogoCompat'

describe('recoverV1ProviderLogoIconKey', () => {
  it('recovers a hashed vite build-asset URL to an icon ref', () => {
    expect(recoverV1ProviderLogoIconKey('/assets/openai-a1b2c3d4.png')).toBe('icon:openai')
    // A hyphenated stem must not be truncated at its own hyphen.
    expect(recoverV1ProviderLogoIconKey('/assets/gitee-ai-deadbeef.png')).toBe('icon:gitee-ai')
    expect(recoverV1ProviderLogoIconKey('/assets/aws-bedrock-00112233.webp')).toBe('icon:aws-bedrock')
  })

  it('handles an absolute file URL and an un-hashed basename', () => {
    expect(recoverV1ProviderLogoIconKey('file:///app.asar/out/renderer/assets/anthropic-ff00ff00.png')).toBe(
      'icon:anthropic'
    )
    expect(recoverV1ProviderLogoIconKey('deepseek.png')).toBe('icon:deepseek')
  })

  it('maps assets named after a different brand to the v2 catalog key', () => {
    expect(recoverV1ProviderLogoIconKey('/assets/microsoft-1111.png')).toBe('icon:azureai') // AzureProviderLogo
    expect(recoverV1ProviderLogoIconKey('/assets/360-2222.png')).toBe('icon:xirang') // ZhinaoProviderLogo
    expect(recoverV1ProviderLogoIconKey('/assets/voyageai-3333.png')).toBe('icon:voyage')
    expect(recoverV1ProviderLogoIconKey('/assets/zai-4444.svg')).toBe('icon:z-ai')
  })

  it('recovers the literal `poe` value and historical camelCase icon keys', () => {
    expect(recoverV1ProviderLogoIconKey('poe')).toBe('icon:poe')
    expect(recoverV1ProviderLogoIconKey('icon:aiOnly')).toBe('icon:ai-only')
  })

  it('drops unrecognized values (renamed key, retired provider, empty)', () => {
    expect(recoverV1ProviderLogoIconKey('icon:aiStudio')).toBeNull()
    expect(recoverV1ProviderLogoIconKey('/assets/cephalon-5555.jpeg')).toBeNull() // retired, no v2 icon
    expect(recoverV1ProviderLogoIconKey('/assets/tokenflux-6666.png')).toBeNull() // retired, no v2 icon
    expect(recoverV1ProviderLogoIconKey('')).toBeNull()
    expect(recoverV1ProviderLogoIconKey('   ')).toBeNull()
  })
})
