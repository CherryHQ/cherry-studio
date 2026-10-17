import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { getProviderIconAssetMetrics } from '../provider-icon-metrics'
import { resolveProviderIconRef } from '../registry'

// The official asset's checksum prevents a traced, cropped or recolored replacement.
const officialLogoSha256 = '3e2c6e2d1a61a549dae2374ec4444c77f4c2617c8f3772bdd4cd6e52bf20767e'

describe('Ace Data Cloud brand asset', () => {
  it.each(['light', 'dark'])('preserves the official PNG and canvas in the %s source and component', (theme) => {
    const files = [
      new URL(`../../../../icons/providers/${theme}/acedatacloud.svg`, import.meta.url),
      new URL(`../providers/acedatacloud/${theme}.tsx`, import.meta.url)
    ]
    for (const file of files) {
      const content = readFileSync(fileURLToPath(file), 'utf8')
      const embedded = content.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)?.[1]
      expect(embedded).toBeDefined()
      expect(createHash('sha256').update(Buffer.from(embedded!, 'base64')).digest('hex')).toBe(officialLogoSha256)
      expect(content).toContain('viewBox="0 0 512 512"')
    }
  })

  it('keeps the original canvas within compact provider icon containers', () => {
    const ref = resolveProviderIconRef('acedatacloud')
    expect(ref?.kind).toBe('provider')
    expect(ref?.key).toBe('acedatacloud')
    expect(getProviderIconAssetMetrics({ kind: 'provider', iconId: ref!.key }).canvasScale).toBe(1)
  })
})
