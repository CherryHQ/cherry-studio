import { createHash } from 'node:crypto'

import type runtimeEntrypoints from './runtime-entrypoints.json'

export type DshRuntimeEntrySpecifier = keyof typeof runtimeEntrypoints

export function runtimeEntryFileName(specifier: string): string {
  if (specifier === '@cherrystudio/dsh-bridge/plugin') return 'cherry-bridge.mjs'
  const slug =
    specifier
      .replace(/^@/, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'entry'
  const digest = createHash('sha1').update(specifier).digest('hex').slice(0, 12)
  return `${slug}-${digest}.mjs`
}
