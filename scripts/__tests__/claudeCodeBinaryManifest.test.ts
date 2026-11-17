import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { claudeCodeBinaryManifest } from '../claudeCodeBinaryManifest'

const root = mkdtempSync(path.join(os.tmpdir(), 'claude-manifest-'))
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('pins all binary integrity values from the application lockfile document and rejects SDK version drift', () => {
  const sdkDir = path.join(root, 'node_modules/@anthropic-ai/claude-agent-sdk')
  mkdirSync(sdkDir, { recursive: true })
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ dependencies: { '@anthropic-ai/claude-agent-sdk': '1.2.3' } })
  )
  writeFileSync(path.join(sdkDir, 'sdk.mjs'), '')
  writeFileSync(
    path.join(sdkDir, 'package.json'),
    JSON.stringify({
      version: '1.2.3',
      main: 'sdk.mjs',
      optionalDependencies: { '@anthropic-ai/claude-agent-sdk-darwin-arm64': '1.2.3' }
    })
  )
  writeFileSync(
    path.join(root, 'pnpm-lock.yaml'),
    `---\npackages: {}\n---\npackages:\n  '@anthropic-ai/claude-agent-sdk@1.2.3': {}\n  '@anthropic-ai/claude-agent-sdk-darwin-arm64@1.2.3':\n    resolution:\n      integrity: sha512-pinned\n`
  )
  expect(claudeCodeBinaryManifest(root)).toEqual({
    version: '1.2.3',
    packages: { 'darwin-arm64': { name: '@anthropic-ai/claude-agent-sdk-darwin-arm64', integrity: 'sha512-pinned' } }
  })
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ dependencies: { '@anthropic-ai/claude-agent-sdk': '1.2.4' } })
  )
  expect(() => claudeCodeBinaryManifest(root)).toThrow('does not match')
})
