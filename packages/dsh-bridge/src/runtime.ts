import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)

export function resolveDshRuntimeEntry(specifier: string): string {
  return require_.resolve(specifier)
}
