import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import type { Plugin } from 'vite'

export function buildInputGuard(root = resolve('.')): Plugin {
  const canonicalRoot = realpathSync(root)
  return {
    name: 'cherry-build-inputs',
    generateBundle() {
      const inputs = [...new Set([...this.getModuleIds()])]
        .map((id) => id.split('?')[0])
        .filter((id) => isAbsolute(id) && !id.includes('/node_modules/') && !id.includes('\\node_modules\\'))
        .map((id) => relative(canonicalRoot, id).replaceAll('\\', '/'))
        .sort()
      this.emitFile({ type: 'asset', fileName: '.build-inputs.json', source: JSON.stringify(inputs) })
    }
  }
}
