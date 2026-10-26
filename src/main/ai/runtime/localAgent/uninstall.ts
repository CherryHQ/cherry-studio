import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import readCmdShim from 'read-cmd-shim'
import { parse as parseToml } from 'smol-toml'

import { application } from '@application'
import { isPathWithin } from '@main/utils/binaryEnv'

import { systemAgentEntry, systemAgentWrapper } from './launch'

const BINARY_MANIFEST = '.cherry-install.json'

async function readBinaryManifest(bundle: string) {
  try {
    const file = path.join(bundle, BINARY_MANIFEST)
    if (!(await fs.lstat(file)).isFile()) return undefined
    const data = JSON.parse(await fs.readFile(file, 'utf8'))
    if (!data || typeof data.executable !== 'string' || !Array.isArray(data.retired)) return undefined
    return {
      executable: data.executable,
      retired: data.retired.filter((name: unknown) => typeof name === 'string') as string[]
    }
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function writeBinaryManifest(executable: string, bundle: string, retired: string[]) {
  const file = path.join(bundle, BINARY_MANIFEST)
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify({ executable, retired }), { flag: 'wx' })
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

export async function getBinaryAgentInstallation(executable: string, detectedPath: string) {
  const entry = systemAgentEntry(executable)
  if (path.resolve(detectedPath) !== entry || !(await fs.lstat(entry)).isFile()) return undefined
  const wrapper = await fs.readFile(entry, 'utf8')
  const match =
    process.platform === 'win32'
      ? /^@echo off\r\n"([^\r\n]+)" %\*\r\n$/.exec(wrapper)
      : /^#!\/bin\/sh\nexec '([^\n]+)' "\$@"\n$/.exec(wrapper)
  if (!match) return undefined
  const command = process.platform === 'win32' ? match[1].replace(/%%/g, '%') : match[1].replace(/'\\''/g, "'")
  if (wrapper !== systemAgentWrapper(command)) return undefined
  const installationRoot = application.getPath('external.acp.agents')
  const root = await fs.realpath(installationRoot)
  const resolvedCommand = await fs.realpath(command)
  const relative = path.relative(installationRoot, command).split(path.sep)
  if (relative.length < 3 || !relative[0].startsWith(`${executable}-`) || relative[1] !== 'files') return undefined
  const bundle = path.join(root, relative[0])
  if (!isPathWithin(root, bundle) || (await fs.realpath(bundle)) !== bundle) return undefined
  if (!isPathWithin(path.join(bundle, 'files'), resolvedCommand)) return undefined
  const manifest = await readBinaryManifest(bundle)
  return { entry, bundle, wrapper, retired: manifest?.executable === executable ? manifest.retired : [] }
}

export async function uninstallBinaryAgent(executable: string, detectedPath: string): Promise<boolean> {
  const installed = await getBinaryAgentInstallation(executable, detectedPath)
  if (!installed) return false
  const root = await fs.realpath(application.getPath('external.acp.agents'))
  for (const name of new Set(installed.retired)) {
    if (name !== path.basename(name) || !name.startsWith(`${executable}-`)) continue
    const bundle = path.join(root, name)
    if (bundle === installed.bundle || !isPathWithin(root, bundle)) continue
    const stat = await fs.lstat(bundle).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    if (!stat?.isDirectory() || (await fs.realpath(bundle)) !== bundle) continue
    const metadata = await readBinaryManifest(bundle)
    if (metadata?.executable !== executable) continue
    await fs.rm(bundle, { recursive: true })
  }
  await fs.rm(installed.bundle, { recursive: true })
  await fs.unlink(installed.entry)
  return true
}

export async function ownsNpmExecutable(root: string, packageName: string, executable: string): Promise<boolean> {
  const directory = path.join(root, packageName)
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
    if (metadata.name !== packageName) return false
    const bins = typeof metadata.bin === 'string' ? [metadata.bin] : Object.values(metadata.bin ?? {})
    const shimTarget: string | undefined = /\.(cmd|ps1)$/i.test(executable) ? await readCmdShim(executable) : undefined
    const resolved = await fs.realpath(
      shimTarget ? path.resolve(path.dirname(executable), shimTarget.replace(/\\/g, path.sep)) : executable
    )
    for (const bin of bins) {
      if (typeof bin !== 'string') continue
      const target = path.resolve(directory, bin)
      if (isPathWithin(directory, target) && (await fs.realpath(target)) === resolved) return true
    }
    return false
  } catch {
    return false
  }
}

export async function ownsUvExecutable(root: string, packageName: string, executable: string): Promise<boolean> {
  try {
    const toolRoot = path.join(root, packageName)
    const receipt = parseToml(await fs.readFile(path.join(toolRoot, 'uv-receipt.toml'), 'utf8'))
    const tool = receipt.tool as { entrypoints?: Array<{ 'install-path'?: string }> } | undefined
    if (!tool?.entrypoints?.some((entry) => entry['install-path'] === executable)) return false
    if (isPathWithin(await fs.realpath(toolRoot), await fs.realpath(executable))) return true
    // uv copies Windows entrypoints instead of linking them into the environment.
    if (process.platform !== 'win32') return false
    const original = path.join(toolRoot, 'Scripts', path.basename(executable))
    return (await fs.readFile(original)).equals(await fs.readFile(executable))
  } catch {
    return false
  }
}
