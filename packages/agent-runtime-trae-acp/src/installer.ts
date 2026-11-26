import { lstat, readFile, realpath, rm, unlink } from 'node:fs/promises'
import path from 'node:path'

export async function traeRemoval(
  expectedPath: string,
  env: Record<string, string>,
  defaults: { bin: string; installation: string },
  run: (args: string[], timeout: number, includeStderr?: boolean) => Promise<string>
) {
  if (process.platform === 'win32') return
  const bin = env.TRAECLI_INSTALL_DIR || env.XDG_BIN_HOME || defaults.bin
  if (path.resolve(expectedPath) !== path.join(bin, 'traecli')) return undefined
  const binary = await realpath(expectedPath)
  const statePath = env.TRAECLI_STATE_DIR || defaults.installation
  const state = await realpath(statePath).catch(() => statePath)
  const release = path.dirname(binary)
  const versioned = path.dirname(release) === path.join(state, 'releases') && path.basename(binary) === 'traex'
  if (
    !versioned &&
    binary !== path.join(await realpath(bin), 'traex') &&
    binary !== path.join(await realpath(bin), 'traecli')
  )
    return undefined
  if (versioned) {
    const receipt = JSON.parse(await readFile(path.join(release, 'trae-installation.json'), 'utf8'))
    if (typeof receipt.auto_update !== 'boolean' || typeof receipt.channel !== 'string') return undefined
    if ((await realpath(release)) !== release) return undefined
  }
  const help = await run(['--help'], 8000, true)
  if (!/TRAE CLI/.test(help)) return undefined
  const original = await lstat(binary)
  return async () => {
    if (/app-server/.test(help)) await run(['app-server', 'daemon', 'stop'], 30_000)
    const current = await lstat(binary)
    if (
      (await realpath(expectedPath)) !== binary ||
      current.ino !== original.ino ||
      current.mtimeMs !== original.mtimeMs
    )
      throw new Error('Installation changed')
    const entries: string[] = []
    for (const name of ['traecli', 'traex', 'coco', 'trae-cli', 'trae-agent', 'ta']) {
      const entry = path.join(bin, name)
      const stat = await lstat(entry).catch(() => undefined)
      if (stat?.isSymbolicLink() && (await realpath(entry).catch(() => undefined)) === binary) entries.push(entry)
    }
    for (const entry of entries) await unlink(entry)
    if (versioned) {
      const currentLink = path.join(state, 'current')
      if (
        (await lstat(currentLink).catch(() => undefined))?.isSymbolicLink() &&
        (await realpath(currentLink)) === release
      )
        await unlink(currentLink)
      await rm(release, { recursive: true })
    } else await unlink(binary)
  }
}
