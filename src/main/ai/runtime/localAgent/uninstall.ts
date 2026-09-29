import fs from 'node:fs/promises'
import path from 'node:path'

import readCmdShim from 'read-cmd-shim'
import { parse as parseToml } from 'smol-toml'

import { application } from '@application'
import { isPathWithin } from '@main/utils/binaryEnv'

import { systemAgentEntry } from './launch'

export async function uninstallBinaryAgent(executable: string, detectedPath: string): Promise<boolean> {
  const entry = systemAgentEntry(executable)
  if (path.resolve(detectedPath) !== entry || !(await fs.lstat(entry)).isFile()) return false
  const wrapper = await fs.readFile(entry, 'utf8')
  const match =
    process.platform === 'win32'
      ? /^@echo off\r\n"([^\r\n]+)" %\*\r\n$/.exec(wrapper)
      : /^#!\/bin\/sh\nexec '([^\n]+)' "\$@"\n$/.exec(wrapper)
  if (!match) return false
  const command = process.platform === 'win32' ? match[1].replace(/%%/g, '%') : match[1].replace(/'\\''/g, "'")
  const expected =
    process.platform === 'win32'
      ? `@echo off\r\n"${command.replace(/%/g, '%%')}" %*\r\n`
      : `#!/bin/sh\nexec '${command.replace(/'/g, "'\\''")}' "$@"\n`
  if (wrapper !== expected) return false
  const installationRoot = application.getPath('external.acp.agents')
  const root = await fs.realpath(installationRoot)
  const resolvedCommand = await fs.realpath(command)
  const relative = path.relative(installationRoot, command).split(path.sep)
  if (relative.length < 3 || !relative[0].startsWith(`${executable}-`) || relative[1] !== 'files') return false
  const bundle = path.join(root, relative[0])
  if (!isPathWithin(root, bundle) || (await fs.realpath(bundle)) !== bundle) return false
  if (!isPathWithin(path.join(bundle, 'files'), resolvedCommand)) return false
  await fs.unlink(entry)
  await fs.rm(bundle, { recursive: true })
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
