import fs from 'node:fs/promises'
import path from 'node:path'

import readCmdShim from 'read-cmd-shim'
import { valid } from 'semver'

export async function resolveInstalledExecutable(executable: string): Promise<string> {
  const shim = /\.(cmd|ps1)$/i.test(executable) ? await readCmdShim(executable) : undefined
  return fs.realpath(shim ? path.resolve(path.dirname(executable), shim.replace(/\\/g, path.sep)) : executable)
}

export async function readInstalledPackageVersion(executable: string): Promise<string | undefined> {
  try {
    const resolved = await resolveInstalledExecutable(executable)
    let directory = path.dirname(resolved)
    while (directory !== path.dirname(directory)) {
      const metadata = await fs
        .readFile(path.join(directory, 'package.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => undefined)
      if (metadata) {
        const bins = typeof metadata.bin === 'string' ? [metadata.bin] : Object.values(metadata.bin ?? {})
        for (const bin of bins) {
          if (
            typeof bin === 'string' &&
            (await fs.realpath(path.resolve(directory, bin)).catch(() => undefined)) === resolved
          )
            return valid(metadata.version) ?? undefined
        }
      }
      directory = path.dirname(directory)
    }
  } catch {
    // Native executables and non-npm installations have no package metadata.
  }
  return undefined
}
