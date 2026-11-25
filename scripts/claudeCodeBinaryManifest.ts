import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { parseAllDocuments } from 'yaml'

export function claudeCodeBinaryManifest(root: string) {
  const project = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const require = createRequire(path.join(root, 'package.json'))

  const sdk = JSON.parse(
    readFileSync(path.join(path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk')), 'package.json'), 'utf8')
  )

  const version: unknown = sdk.version

  if (typeof version !== 'string' || version !== project.dependencies['@anthropic-ai/claude-agent-sdk']) {
    throw new Error('Claude SDK installation does not match package.json')
  }

  const lock = parseAllDocuments(readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'))
    .map((doc) => {
      if (doc.errors.length) throw doc.errors[0]

      return doc.toJS()
    })
    .find((doc) => doc.packages?.[`@anthropic-ai/claude-agent-sdk@${version}`])

  if (!lock) throw new Error('Claude SDK is missing from pnpm-lock.yaml')
  const packages: Record<string, { name: string; integrity: string }> = {}

  for (const [name, binaryVersion] of Object.entries(sdk.optionalDependencies)) {
    const target = name.replace('@anthropic-ai/claude-agent-sdk-', '')
    const integrity = lock.packages[`${name}@${binaryVersion}`]?.resolution?.integrity

    if (binaryVersion !== version || !integrity?.startsWith('sha512-')) {
      throw new Error(`Missing pinned Claude binary integrity: ${name}@${binaryVersion}`)
    }

    packages[target] = { name, integrity }
  }

  if (Object.keys(packages).length === 0) throw new Error('Claude SDK has no native packages')

  return { version, packages }
}
