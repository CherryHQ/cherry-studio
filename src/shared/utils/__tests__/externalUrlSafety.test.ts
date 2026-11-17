import { describe, expect, it } from 'vitest'

import { EXTERNAL_LINK_PROTOCOLS, isSafeExternalUrl, resolveSafeExternalUrl } from '../externalUrlSafety'

const ACCEPTED = [
  'zotero://open-pdf/library/items/X',
  'zotero://open-pdf/groups/123/items/ABCD1234?page=7&annotation=EFGH5678',
  'zotero://select/library/items/ABCD1234',
  'zotero://select/groups/123/collections/ABCD1234',
  'zotero://select/library/collections/ABCD1234/items/EFGH5678',
  'zotero://select/items/0_ABCD1234',
  'zotero://open-pdf/0_ABCD1234/7',
  'obsidian://open?vault=Research',
  'obsidian://open?path=%2Fhome%2Fu%2FVault%2FNote.md',
  'obsidian://new?file=Folder%2FNote.md&vault=Research&clipboard&prepend=true',
  'obsidian://open',
  'siyuan://blocks/x',
  'siyuan://blocks/20221031001313-rk7sd0e?focus=1&fullscreen=1',
  'ZOTERO://open-pdf/library/items/X',
  'siyuan://blocks/a/../x',
  'zotero://open-pdf/library/items/X?redirect=http://file/a'
]
const REJECTED = [
  'javascript:alert(1)',
  'file:///etc/passwd',
  'data:text/html,<script>alert(1)</script>',
  'vscode://command/workbench.action.terminal.sendSequence',
  'vscode://ms-python.python/do-something',
  'cursor://settings',
  'zed://file@evil.example/path',
  'obsidian:open?vault=v',
  'obsidian://search?query=x',
  'obsidian://advanced-uri?vault=v',
  'obsidian://daily?vault=v',
  'obsidian://OPEN?vault=v',
  'obsidian://open/path',
  'obsidian://user:pass@open?vault=v',
  'obsidian://open:123?vault=v',
  'obsidian://%6fpen?vault=v',
  'obsidian://open?file=%ZZ',
  'zotero://debug/anything',
  'zotero://open-pdf/library/items/',
  'zotero://open-pdf/groups/not-a-number/items/X',
  'siyuan://blocks/',
  'siyuan://blocks/x/y',
  'siyuan://blocks/x%2Fy',
  'siyuan://blocks.example/x'
]

describe('external URL policy', () => {
  it.each(ACCEPTED)('resolves knowledge URL %s for confirmation', (input) => {
    expect(resolveSafeExternalUrl(input)).toEqual({
      url:
        input === 'ZOTERO://open-pdf/library/items/X'
          ? 'zotero://open-pdf/library/items/X'
          : input === 'siyuan://blocks/a/../x'
            ? 'siyuan://blocks/x'
            : input,
      protocol: input.slice(0, input.indexOf(':') + 1).toLowerCase(),
      requiresConfirmation: true
    })
    expect(isSafeExternalUrl(input)).toBe(true)
  })
  it.each(REJECTED)('rejects %s', (input) => {
    expect(resolveSafeExternalUrl(input)).toBeNull()
    expect(isSafeExternalUrl(input)).toBe(false)
  })
  it('dispatches explicit normalization examples', () => {
    expect(resolveSafeExternalUrl('SIYUAN://blocks/a/../Target?flag&x=1&x=2#Case')?.url).toBe(
      'siyuan://blocks/Target?flag&x=1&x=2#Case'
    )
    expect(resolveSafeExternalUrl('OBSIDIAN://open?vault=')?.url).toBe('obsidian://open?vault=')
    expect(resolveSafeExternalUrl('zotero://select/groups/7/searches/Case/items/Target')?.url).toBe(
      'zotero://select/groups/7/searches/Case/items/Target'
    )
  })
  it.each(['HTTP://example.com', 'https://example.com/a?x=%2f', 'mailto:u@example.com'])(
    'preserves non-confirmed dispatch: %s',
    (url) => {
      expect(resolveSafeExternalUrl(url)).toEqual({ url, protocol: new URL(url).protocol, requiresConfirmation: false })
    }
  )
  it.each([
    'vscode://file/tmp/a',
    'vscode-insiders://file/C%3A/a',
    'cursor://file/tmp/a',
    'zed://file/tmp/a',
    'zed://fileC%3A/a',
    'zed://filed%3a/a'
  ])('preserves editor dispatch: %s', (url) => {
    expect(resolveSafeExternalUrl(url)).toEqual({ url, protocol: new URL(url).protocol, requiresConfirmation: true })
  })
  it.each([
    '',
    'no-url',
    'irc://host',
    'ircs://host',
    'xmpp:u@host',
    'tel:123',
    'vscode://user@file/a',
    'cursor://file:pass@file/a',
    'zed://user@file/a',
    'siyuan://blocks/x%5Cy',
    'siyuan://blocks/x%3fy',
    'siyuan://blocks/x%23y',
    'siyuan://blocks/x%00',
    'siyuan://blocks/x%7f',
    'siyuan://blocks/x/',
    'siyuan://blocks/x\\y',
    'siyuan://blocks/x y',
    'siyuan://blocks/x\ny',
    'obsidian://open/',
    'obsidian:///open',
    'siyuan://BLOCKS/x',
    'zotero://select/library/%69tems/X',
    'siyuan://blocks/%FF',
    'zotero://select/library/items/X/extra',
    'zotero://open-pdf/library/items/X/'
  ])('rejects malformed or unsupported shape: %s', (url) => {
    expect(resolveSafeExternalUrl(url)).toBeNull()
  })
  it('exposes exactly the frozen policy schemes', () => {
    expect(EXTERNAL_LINK_PROTOCOLS).toEqual([
      'http',
      'https',
      'mailto',
      'obsidian',
      'zotero',
      'siyuan',
      'vscode',
      'vscode-insiders',
      'cursor',
      'zed'
    ])
    expect(Object.isFrozen(EXTERNAL_LINK_PROTOCOLS)).toBe(true)
  })
})
