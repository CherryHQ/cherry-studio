import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { readRegistry, reconcileRegistry, serializeRegistry, writeRegistry } from './registry'
import { isUiSourceFile, scanUiSources } from './scan'

const execFileAsync = promisify(execFile)

async function gitOutput(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: root, encoding: 'utf8' })
  return stdout
}

function uniquePathByHash(entries: ReadonlyArray<readonly [path: string, hash: string]>): Map<string, string> {
  const pathsByHash = new Map<string, string[]>()
  for (const [path, hash] of entries) {
    pathsByHash.set(hash, [...(pathsByHash.get(hash) ?? []), path])
  }
  return new Map(
    [...pathsByHash].flatMap(([hash, paths]): Array<[string, string]> => (paths.length === 1 ? [[hash, paths[0]]] : []))
  )
}

async function gitFileMoves(root: string): Promise<Map<string, string>> {
  const renamed = await gitOutput(root, [
    'diff',
    '--name-status',
    '-z',
    '--find-renames=100%',
    '--diff-filter=R',
    'HEAD'
  ])
  const fields = renamed.split('\0')
  const previousSourceByCurrent = new Map<string, string>()

  for (let index = 0; index < fields.length; ) {
    const status = fields[index++]
    if (!status) break
    const previousSource = fields[index++]
    const currentSource = fields[index++]
    if (status.startsWith('R') && previousSource && currentSource) {
      previousSourceByCurrent.set(currentSource, previousSource)
    }
  }

  const [deletedOutput, untrackedOutput] = await Promise.all([
    gitOutput(root, ['diff', '--name-only', '-z', '--diff-filter=D', 'HEAD', '--', 'src/renderer', 'packages/ui/src']),
    gitOutput(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', 'src/renderer', 'packages/ui/src'])
  ])
  const deleted = deletedOutput.split('\0').filter((path) => path && isUiSourceFile(path))
  const untracked = untrackedOutput.split('\0').filter((path) => path && isUiSourceFile(path))
  const [deletedHashes, untrackedHashes] = await Promise.all([
    Promise.all(
      deleted.map(async (path) => [path, (await gitOutput(root, ['rev-parse', `HEAD:${path}`])).trim()] as const)
    ),
    Promise.all(
      untracked.map(async (path) => [path, (await gitOutput(root, ['hash-object', '--', path])).trim()] as const)
    )
  ])
  const deletedByHash = uniquePathByHash(deletedHashes)
  const untrackedByHash = uniquePathByHash(untrackedHashes)

  for (const [hash, currentSource] of untrackedByHash) {
    const previousSource = deletedByHash.get(hash)
    if (previousSource) previousSourceByCurrent.set(currentSource, previousSource)
  }

  return previousSourceByCurrent
}

async function main(): Promise<void> {
  const root = resolve(process.cwd())
  const checkOnly = process.argv.includes('--check')
  const previous = await readRegistry(root)
  const descriptors = await scanUiSources(root, await gitFileMoves(root))
  const next = reconcileRegistry(previous, descriptors)

  if (serializeRegistry(previous) === serializeRegistry(next)) {
    process.stdout.write(`UI contract registry is current (${next.nodes.length} nodes).\n`)
  } else if (checkOnly) {
    process.stderr.write('UI contract registry is stale. Run `pnpm ui:contract:sync`.\n')
    process.exitCode = 1
  } else {
    await writeRegistry(root, next)
    process.stdout.write(`Updated UI contract registry (${next.nodes.length} nodes).\n`)
  }
}

void main()
