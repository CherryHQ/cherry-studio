import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  assertAllowedEntitlements,
  assertMatchingArchitectures,
  parseEntitlementKeys,
  parseMachOArchitectures
} = require('../scripts/smoke-packaged.cjs')

describe('packaged helper signing policy', () => {
  it('parses entitlement keys from codesign XML', () => {
    expect(
      parseEntitlementKeys(`Executable=/Applications/Cherry Studio.app/Contents/Resources/system-speech/cherry-system-speech
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>`)
    ).toEqual(['com.apple.security.cs.allow-jit', 'com.apple.security.cs.disable-library-validation'])
  })

  it('accepts an empty entitlement dictionary and rejects every entitlement in PR1', () => {
    expect(parseEntitlementKeys('<plist version="1.0"><dict/></plist>')).toEqual([])
    expect(() => assertAllowedEntitlements([])).not.toThrow()
    expect(() => assertAllowedEntitlements(['com.apple.security.cs.allow-jit'])).toThrow(
      'Packaged helper has forbidden entitlements: com.apple.security.cs.allow-jit'
    )
  })
})

describe('packaged helper architecture policy', () => {
  it('parses one or more Mach-O architectures without depending on output order', () => {
    expect(parseMachOArchitectures('arm64\n')).toEqual(['arm64'])
    expect(parseMachOArchitectures('x86_64 arm64\n')).toEqual(['arm64', 'x86_64'])
  })

  it('requires the helper architectures to exactly match the packaged app executable', () => {
    expect(() => assertMatchingArchitectures(['arm64', 'x86_64'], ['x86_64', 'arm64'])).not.toThrow()
    expect(() => assertMatchingArchitectures(['arm64'], ['x86_64'])).toThrow(
      'Packaged helper architectures arm64 do not match app architectures x86_64'
    )
  })

  it('rejects missing or unrecognized lipo output', () => {
    expect(() => parseMachOArchitectures('')).toThrow('Unable to read Mach-O architectures')
    expect(() => parseMachOArchitectures('not a Mach-O file')).toThrow('Unable to read Mach-O architectures')
  })
})
