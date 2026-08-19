/** Pure helpers for Cherry Studio's bilingual documentation contract. */
import { createHash } from 'node:crypto'
import { basename } from 'node:path'

import matter from 'gray-matter'
import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

export interface PairingManifest {
  roots: string[]
  excluded: string[]
}

export interface PairPaths {
  source: string
  zh: string
  meta: string
}

export interface PairRecord {
  sourceHash: string
  zhHash: string
}

export interface StructureSignature {
  headings: number[]
  code: string[]
  tables: string[]
  lists: string[]
  links: string[]
}

export type PairingRequest = {
  input: 'worktree' | 'index'
  mode: 'check' | 'list' | 'write'
  scope: 'corpus' | 'pairs'
  anchors: string[]
}

const META_LINE = /^([^:#]+\.md): ([0-9a-f]{40})$/

export const normalizeRepoPath = (value: string): string => value.replaceAll('\\', '/').replace(/^\.\//, '')

export const pairAnchor = (argument: string): string => {
  const value = normalizeRepoPath(argument)
  if (value.endsWith('.zh.md')) return `${value.slice(0, -'.zh.md'.length)}.md`
  if (value.endsWith('.i18n.yaml')) return `${value.slice(0, -'.i18n.yaml'.length)}.md`
  return value.endsWith('.md') ? value : `${value}.md`
}

export const pairPaths = (source: string): PairPaths => {
  if (!source.endsWith('.md') || source.endsWith('.zh.md')) throw new Error(`invalid English Markdown path: ${source}`)
  return {
    source,
    zh: source.replace(/\.md$/, '.zh.md'),
    meta: source.replace(/\.md$/, '.i18n.yaml')
  }
}

export const blobHash = (content: Buffer): string => {
  const hash = createHash('sha1')
  hash.update(`blob ${content.byteLength}\0`)
  hash.update(content)
  return hash.digest('hex')
}

export const parseRecord = (content: string, paths: PairPaths): PairRecord | undefined => {
  const values = new Map<string, string>()
  for (const line of content.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const match = META_LINE.exec(line)
    if (!match?.[1] || !match[2] || values.has(match[1])) return undefined
    values.set(match[1], match[2])
  }
  const sourceHash = values.get(basename(paths.source))
  const zhHash = values.get(basename(paths.zh))
  return values.size === 2 && sourceHash && zhHash ? { sourceHash, zhHash } : undefined
}

export const renderRecord = (paths: PairPaths, record: PairRecord): string =>
  [
    '# Bilingual-pair consistency record (docs/i18n/README.md).',
    '# After editing either side, update its counterpart and re-record with:',
    `#   pnpm docs:check-pairing --write ${paths.source}`,
    `${basename(paths.source)}: ${record.sourceHash}`,
    `${basename(paths.zh)}: ${record.zhHash}`,
    ''
  ].join('\n')

const validRepoPath = (value: string): boolean =>
  value.length > 0 && !value.startsWith('/') && !value.split('/').includes('..') && value === normalizeRepoPath(value)

export const parseManifest = (content: string): PairingManifest => {
  const parsed: unknown = JSON.parse(content)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('manifest must be an object')
  const record = parsed as Record<string, unknown>
  const unknown = Object.keys(record).filter((key) => key !== 'roots' && key !== 'excluded')
  if (unknown.length) throw new Error(`unsupported manifest field(s): ${unknown.join(', ')}`)
  if (
    !Array.isArray(record.roots) ||
    record.roots.length === 0 ||
    !record.roots.every((item) => typeof item === 'string')
  ) {
    throw new Error('manifest roots must be a non-empty string array')
  }
  if (!Array.isArray(record.excluded) || !record.excluded.every((item) => typeof item === 'string')) {
    throw new Error('manifest excluded must be a string array')
  }
  const roots = record.roots.map(normalizeRepoPath)
  const excluded = record.excluded.map(normalizeRepoPath)
  if (![...roots, ...excluded].every(validRepoPath))
    throw new Error('manifest paths must be normalized repo-relative paths')
  return { roots: [...new Set(roots)].sort(), excluded: [...new Set(excluded)].sort() }
}

const underRoot = (file: string, root: string): boolean =>
  file === root || file.startsWith(`${root.replace(/\/$/, '')}/`)

export const isInScope = (source: string, manifest: PairingManifest): boolean =>
  manifest.roots.some((root) => underRoot(source, root)) && !manifest.excluded.includes(source)

export const isExcluded = (source: string, manifest: PairingManifest): boolean => manifest.excluded.includes(source)

export const parsePairingArgs = (args: string[]): PairingRequest => {
  const flags = args.filter((arg) => arg.startsWith('--'))
  const anchors = [...new Set(args.filter((arg) => !arg.startsWith('--')).map(pairAnchor))].sort()
  const unknown = flags.filter((flag) => !['--list', '--write', '--all', '--cached'].includes(flag))
  if (unknown.length) throw new Error(`unknown flag(s): ${unknown.join(', ')}`)
  const list = flags.includes('--list')
  const write = flags.includes('--write')
  const all = flags.includes('--all')
  const cached = flags.includes('--cached')
  if (list && (write || all || cached || anchors.length)) throw new Error('--list takes no other flags or paths')
  if (all && !write) throw new Error('--all only applies to --write')
  if (cached && write) throw new Error('--cached is read-only')
  if (cached && anchors.length === 0) throw new Error('--cached requires staged paths')
  if (write && anchors.length === 0 && !all) throw new Error('--write requires confirmed pair paths or --all')
  if (write && anchors.length > 0 && all) throw new Error('--write takes paths or --all, not both')
  if (list) return { input: 'worktree', mode: 'list', scope: 'corpus', anchors: [] }
  if (write) return { input: 'worktree', mode: 'write', scope: all ? 'corpus' : 'pairs', anchors }
  return { input: cached ? 'index' : 'worktree', mode: 'check', scope: anchors.length ? 'pairs' : 'corpus', anchors }
}

const parseMarkdown = (content: string): Root => unified().use(remarkParse).use(remarkGfm).parse(content)

const structureSignature = (content: string, ignoredLink: string): StructureSignature => {
  const tree = parseMarkdown(content)
  const signature: StructureSignature = { headings: [], code: [], tables: [], lists: [], links: [] }
  visit(tree, 'heading', (node) => signature.headings.push(node.depth))
  visit(tree, 'code', (node) => signature.code.push(`${node.lang ?? ''}|${node.meta ?? ''}|${node.value}`))
  visit(tree, 'table', (node) =>
    signature.tables.push(`${node.children.length}x${node.children[0]?.children.length ?? 0}`)
  )
  visit(tree, 'list', (node) =>
    signature.lists.push(
      node.ordered ? `ordered:${node.start ?? 1}:${node.children.length}` : `bullet:${node.children.length}`
    )
  )
  visit(tree, 'link', (node) => {
    if (node.url !== ignoredLink) signature.links.push(node.url)
  })
  return signature
}

const firstDifference = (label: string, left: readonly unknown[], right: readonly unknown[]): string | undefined => {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index])
      return `${label} #${index + 1} differs: ${JSON.stringify(left[index])} vs ${JSON.stringify(right[index])}`
  }
  return undefined
}

const deepEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const checkFrontmatter = (source: string, zh: string): string[] => {
  const sourceData = matter(source).data as Record<string, unknown>
  const zhData = matter(zh).data as Record<string, unknown>
  const errors: string[] = []
  const keys = [...new Set([...Object.keys(sourceData), ...Object.keys(zhData)])].sort()
  if (!deepEqual(Object.keys(sourceData).sort(), Object.keys(zhData).sort())) errors.push('frontmatter keys differ')
  for (const key of keys) {
    if (key === 'description') {
      for (const [side, value] of [
        ['English', sourceData[key]],
        ['Chinese', zhData[key]]
      ] as const) {
        if (typeof value !== 'string' || !value.trim() || value.includes('\n'))
          errors.push(`${side} description must be one non-empty line`)
      }
    } else if (!deepEqual(sourceData[key], zhData[key])) {
      errors.push(`frontmatter ${JSON.stringify(key)} must match exactly`)
    }
  }
  return errors
}

const switcherError = (file: string, content: string, counterpart: string, chinese: boolean): string | undefined => {
  const body = matter(content).content.replace(/^\r?\n/u, '')
  const lines = body.split('\n')
  const expected = chinese ? `[English](${basename(counterpart)}) | 中文` : `English | [中文](${basename(counterpart)})`
  const agentNote = /^\.agents\/notes\/(?:proposed|implemented|rejected)\//u.test(file)
  const position = agentNote ? 4 : 2
  if (!/^# \S/u.test(lines[0] ?? '')) return 'missing H1 heading'
  if (lines[position] !== expected) return `line ${position + 1} must be ${JSON.stringify(expected)}`
  return undefined
}

export const validatePairContent = (paths: PairPaths, source: Buffer, zh: Buffer): string[] => {
  const sourceText = source.toString('utf8')
  const zhText = zh.toString('utf8')
  const errors = checkFrontmatter(sourceText, zhText)
  const sourceSwitcher = switcherError(paths.source, sourceText, paths.zh, false)
  const zhSwitcher = switcherError(paths.zh, zhText, paths.source, true)
  if (sourceSwitcher) errors.push(`${paths.source}: ${sourceSwitcher}`)
  if (zhSwitcher) errors.push(`${paths.zh}: ${zhSwitcher}`)

  const sourceStructure = structureSignature(matter(sourceText).content, basename(paths.zh))
  const zhStructure = structureSignature(matter(zhText).content, basename(paths.source))
  for (const [label, left, right] of [
    ['heading depth', sourceStructure.headings, zhStructure.headings],
    ['code block', sourceStructure.code, zhStructure.code],
    ['table dimensions', sourceStructure.tables, zhStructure.tables],
    ['list structure', sourceStructure.lists, zhStructure.lists],
    ['link target', sourceStructure.links, zhStructure.links]
  ] as const) {
    const difference = firstDifference(label, left, right)
    if (difference) errors.push(`${paths.source} ↔ ${paths.zh}: ${difference}`)
  }
  return errors
}
