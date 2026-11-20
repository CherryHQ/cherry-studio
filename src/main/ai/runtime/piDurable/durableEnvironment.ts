import { stat } from 'node:fs/promises'
import path from 'node:path'

import type { Context } from '@earendil-works/chord/context'
import type { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'

import { assertNotMemoryHardLink, memoryTarget } from '@main/ai/memory/memoryTarget'
import { canonicalizePathForContainment } from '@main/utils/file'

/** Check the actual file used by native read, write and edit, after Pi selects its filename variant. */
export async function createDurableEnvironment(options: ConstructorParameters<typeof NodeExecutionEnv>[0]) {
  const { NodeExecutionEnv } = await import('@earendil-works/pi-durable/env/node')
  class DesktopEnvironment extends NodeExecutionEnv {
    private async filePath(candidate: string, context: Context, noFollow = false) {
      const resolved = await this.absolutePath(candidate, context)
      if (!resolved.ok) throw resolved.error
      const target = resolved.value
      // Preserve the SDK's final-component symlink check for noFollow reads.
      const resolvedPath = await canonicalizePathForContainment(noFollow ? path.dirname(target) : target, {
        allowMissing: true
      })
      const canonical = noFollow && resolvedPath ? path.join(resolvedPath, path.basename(target)) : resolvedPath
      if (!canonical || (await memoryTarget(target, canonical)))
        throw new Error('Use the memory editor for managed memory files')
      return canonical
    }

    override async openBinaryReader(file: string, options: { noFollow?: boolean } | undefined, context: Context) {
      return super.openBinaryReader(await this.filePath(file, context, options?.noFollow), options, context)
    }

    override async readTextFile(file: string, context: Context) {
      return super.readTextFile(await this.filePath(file, context), context)
    }

    override async writeFile(file: string, content: string | Uint8Array, context: Context) {
      return super.writeFile(await this.filePath(file, context), content, context)
    }
  }
  return new DesktopEnvironment({
    ...options,
    async authorizeOpenedFile(file, opened) {
      if (opened.ino === 0n) throw new Error('The file has no verifiable identity')
      if (!opened.isFile() || (await memoryTarget(file)))
        throw new Error('Use the memory editor for managed memory files')
      await assertNotMemoryHardLink(opened)
      const current = await stat(file, { bigint: true })
      if (
        current.dev !== opened.dev ||
        current.ino !== opened.ino ||
        current.nlink !== opened.nlink ||
        current.ctimeNs !== opened.ctimeNs
      )
        throw new Error('The file changed during authorization; retry the operation')
    }
  })
}
