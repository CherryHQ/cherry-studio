import { stat } from 'node:fs/promises'

import type { Context } from '@earendil-works/chord/context'
import type { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'

import { memoryTarget } from '@main/ai/memory/memoryTarget'
import { canonicalizePathForContainment } from '@main/utils/file'

/** Check the actual file used by native read, write and edit, after Pi selects its filename variant. */
export async function createDurableEnvironment(options: ConstructorParameters<typeof NodeExecutionEnv>[0]) {
  const { NodeExecutionEnv } = await import('@earendil-works/pi-durable/env/node')
  class DesktopEnvironment extends NodeExecutionEnv {
    private async filePath(candidate: string, context: Context) {
      const resolved = await this.absolutePath(candidate, context)
      if (!resolved.ok) throw resolved.error
      const target = resolved.value
      const canonical = await canonicalizePathForContainment(target, { allowMissing: true })
      if (!canonical || (await memoryTarget(target))) throw new Error('Use the memory editor for managed memory files')
      try {
        if ((await stat(canonical)).nlink > 1) throw new Error('A native file tool cannot verify a hard-linked file')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      return canonical
    }

    override async openBinaryReader(file: string, options: { noFollow?: boolean } | undefined, context: Context) {
      return super.openBinaryReader(await this.filePath(file, context), options, context)
    }

    override async readTextFile(file: string, context: Context) {
      return super.readTextFile(await this.filePath(file, context), context)
    }

    override async writeFile(file: string, content: string | Uint8Array, context: Context) {
      return super.writeFile(await this.filePath(file, context), content, context)
    }
  }
  return new DesktopEnvironment(options)
}
