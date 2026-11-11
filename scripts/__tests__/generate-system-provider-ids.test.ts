import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SystemProviderIds } from '../../src/shared/utils/systemProviderId'
import { CLI_ONLY_PROVIDER_IDS, extractSystemProviderIds } from '../generate-system-provider-ids'

const providersJson = readFileSync(
  join(__dirname, '..', '..', 'packages', 'provider-registry', 'data', 'providers.json'),
  'utf8'
)

describe('generate-system-provider-ids', () => {
  it('excludes the CLI-only backends and matches the committed SystemProviderIds', () => {
    const ids = extractSystemProviderIds(providersJson)

    for (const excluded of CLI_ONLY_PROVIDER_IDS) {
      expect(ids).not.toContain(excluded)
    }
    // Drift sentinel: the generated set must equal the committed enum (else run
    // `pnpm gen:system-provider-ids`). CI also enforces this via generate-and-diff.
    expect(ids).toEqual(Object.keys(SystemProviderIds).sort((a, b) => a.localeCompare(b)))
  })

  it('throws when an exclude entry no longer exists in the registry', () => {
    const bogus = JSON.stringify({ providers: [{ id: 'openai' }] })
    expect(() => extractSystemProviderIds(bogus)).toThrow(/CLI_ONLY_PROVIDER_IDS/)
  })
})
