/** Validate and record English/Simplified-Chinese documentation pairs. */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  blobHash,
  isExcluded,
  isInScope,
  pairAnchor,
  pairPaths,
  parseManifest,
  parsePairingArgs,
  parseRecord,
  renderRecord,
  validatePairContent
} from './translation-pairing'

const ROOT = path.resolve(__dirname, '..')
const MANIFEST = 'scripts/translation-pairing.manifest.json'

type Reader = (file: string) => Buffer | undefined
type PairState = 'ok' | 'missing' | 'out-of-sync' | 'invalid' | 'deleted'

const readWorktree: Reader = (file) => {
  const absolute = path.join(ROOT, file)
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? fs.readFileSync(absolute) : undefined
}

const readIndex: Reader = (file) => {
  const result = spawnSync('git', ['show', `:${file}`], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 })
  return result.status === 0 ? result.stdout : undefined
}

const walkFiles = (relative: string, files: Set<string>): void => {
  const absolute = path.join(ROOT, relative)
  if (!fs.existsSync(absolute)) return
  const stat = fs.statSync(absolute)
  if (stat.isFile()) {
    files.add(relative)
    return
  }
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = `${relative.replace(/\/$/, '')}/${entry.name}`
    if (entry.isDirectory()) walkFiles(child, files)
    else if (entry.isFile()) files.add(child)
  }
}

const corpusAnchors = (roots: string[]): string[] => {
  const files = new Set<string>()
  for (const root of roots) walkFiles(root, files)
  return [
    ...new Set([...files].filter((file) => file.endsWith('.md') || file.endsWith('.i18n.yaml')).map(pairAnchor))
  ].sort()
}

const validatePair = (
  anchor: string,
  reader: Reader,
  manifest: ReturnType<typeof parseManifest>
): { state: PairState; errors: string[] } => {
  const paths = pairPaths(anchor)
  const source = reader(paths.source)
  const zh = reader(paths.zh)
  const meta = reader(paths.meta)
  const present = [source, zh, meta].filter(Boolean).length

  if (present === 0) return { state: 'deleted', errors: [] }
  if (isExcluded(anchor, manifest)) {
    const errors: string[] = []
    if (zh) errors.push(`${paths.zh}: ${paths.source} is excluded from pairing`)
    if (meta) errors.push(`${paths.meta}: ${paths.source} is excluded from pairing`)
    return { state: errors.length ? 'invalid' : 'ok', errors }
  }
  if (!isInScope(anchor, manifest)) return { state: 'deleted', errors: [] }

  const missing = [
    !source ? paths.source : undefined,
    !zh ? paths.zh : undefined,
    !meta ? paths.meta : undefined
  ].filter((value): value is string => Boolean(value))
  if (missing.length)
    return { state: 'missing', errors: [`${anchor}: incomplete pair — missing ${missing.join(', ')}`] }

  const structureErrors = validatePairContent(paths, source!, zh!)
  if (structureErrors.length) return { state: 'invalid', errors: structureErrors }
  const record = parseRecord(meta!.toString('utf8'), paths)
  if (!record) return { state: 'invalid', errors: [`${paths.meta}: malformed consistency record`] }

  const errors: string[] = []
  if (record.sourceHash !== blobHash(source!)) errors.push(`${paths.source}: out of sync with ${paths.meta}`)
  if (record.zhHash !== blobHash(zh!)) errors.push(`${paths.zh}: out of sync with ${paths.meta}`)
  return { state: errors.length ? 'out-of-sync' : 'ok', errors }
}

export const runPairing = (args: string[]): number => {
  let request: ReturnType<typeof parsePairingArgs>
  try {
    request = parsePairingArgs(args)
  } catch (error) {
    console.error(`docs:check-pairing: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  const reader = request.input === 'index' ? readIndex : readWorktree
  const manifestContent = reader(MANIFEST)
  if (!manifestContent) {
    console.error(`docs:check-pairing: ${MANIFEST} is missing`)
    return 2
  }
  let manifest: ReturnType<typeof parseManifest>
  try {
    manifest = parseManifest(manifestContent.toString('utf8'))
  } catch (error) {
    console.error(`docs:check-pairing: invalid manifest: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  const anchors = request.scope === 'corpus' ? corpusAnchors(manifest.roots) : request.anchors

  if (request.mode === 'write') {
    const errors: string[] = []
    const pending: { path: string; content: string }[] = []
    for (const anchor of anchors) {
      if (!isInScope(anchor, manifest)) continue
      const paths = pairPaths(anchor)
      const source = readWorktree(paths.source)
      const zh = readWorktree(paths.zh)
      if (!source || !zh) {
        errors.push(`${anchor}: cannot record an incomplete pair`)
        continue
      }
      const structureErrors = validatePairContent(paths, source, zh)
      if (structureErrors.length) {
        errors.push(...structureErrors)
        continue
      }
      const rendered = renderRecord(paths, { sourceHash: blobHash(source), zhHash: blobHash(zh) })
      const absolute = path.join(ROOT, paths.meta)
      if (!fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== rendered) {
        pending.push({ path: paths.meta, content: rendered })
      }
    }
    if (errors.length) {
      console.error('Pairing records were not written:')
      for (const error of errors) console.error(`  ${error}`)
      return 1
    }
    for (const item of pending) {
      fs.writeFileSync(path.join(ROOT, item.path), item.content)
      console.log(`Recorded ${item.path}`)
    }
    console.log(`Pairing records updated: ${pending.length}`)
    return 0
  }

  const states = new Map<string, PairState>()
  const errors: string[] = []
  for (const anchor of anchors) {
    if (!isInScope(anchor, manifest) && !isExcluded(anchor, manifest)) continue
    const result = validatePair(anchor, reader, manifest)
    if (isExcluded(anchor, manifest)) {
      if (result.errors.length) states.set(anchor, 'invalid')
    } else if (result.state !== 'deleted') {
      states.set(anchor, result.state)
    }
    errors.push(...result.errors)
  }

  if (request.mode === 'list') {
    for (const [anchor, state] of [...states].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`${state.padEnd(11)} ${anchor}`)
    }
    const counts = [...states.values()].reduce<Record<string, number>>((result, state) => {
      result[state] = (result[state] ?? 0) + 1
      return result
    }, {})
    console.log(`Pairing: ${JSON.stringify(counts)}`)
    return 0
  }

  if (errors.length) {
    console.error('Bilingual pairing violations:')
    for (const error of errors) console.error(`  ${error}`)
    return 1
  }
  console.log(`Bilingual pairing OK (${[...states.values()].filter((state) => state === 'ok').length} pairs).`)
  return 0
}

if (require.main === module) process.exitCode = runPairing(process.argv.slice(2))
