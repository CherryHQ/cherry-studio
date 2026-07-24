import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { scanUiSources } from '../scan'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')

/**
 * Extract every backticked token from the "The maintained ... currently
 * includes:" bullet lists in the contract document, so newly documented
 * anchors are enforced without editing this test.
 */
async function documentedMaintainedTokens(): Promise<string[]> {
  const document = await readFile(resolve(repoRoot, 'docs/references/ui-semantic-contract.md'), 'utf8')
  const lists = document.match(/^The maintained .* currently includes:\n\n(?:-[^\n]*\n(?:[ \t]+[^\n]*\n)*)+/gm) ?? []
  return lists.flatMap((list) => (list.match(/`[^`]+`/g) ?? []).map((token) => token.slice(1, -1)))
}

describe('maintained UI contract anchors', () => {
  it('keeps every documented maintained anchor authored in current source', { timeout: 60_000 }, async () => {
    const tokens = await documentedMaintainedTokens()
    const semanticIds = tokens.filter((token) => !token.startsWith('part:'))
    const parts = tokens.filter((token) => token.startsWith('part:')).map((token) => token.slice('part:'.length))
    // If the document reshapes and the extraction stops matching, fail loudly
    // instead of silently enforcing nothing.
    expect(semanticIds.length).toBeGreaterThanOrEqual(15)
    expect(parts.length).toBeGreaterThanOrEqual(3)

    const descriptors = await scanUiSources(repoRoot)
    // Maintained anchors are public API and must be explicit, per the
    // contract's compatibility rules — an inferred match is a regression.
    const explicitIds = new Set(
      descriptors.filter((descriptor) => descriptor.semanticSource === 'explicit').map((d) => d.semanticId)
    )
    const authoredParts = new Set(descriptors.flatMap((descriptor) => descriptor.parts))
    const missing = [
      ...semanticIds.filter((semanticId) => !explicitIds.has(semanticId)),
      ...parts.filter((part) => !authoredParts.has(part)).map((part) => `part:${part}`)
    ]
    expect(missing).toEqual([])
  })
})
