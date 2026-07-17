import { createHash } from 'node:crypto'
import { relative, sep } from 'node:path'

import type { UiNodeDescriptor } from './types'

const NON_SEMANTIC_PATH_SEGMENTS = new Set([
  'src',
  'renderer',
  'packages',
  'ui',
  'components',
  'component',
  'pages',
  'windows',
  'primitives',
  'composites',
  'internal',
  'base',
  'index'
])

const NON_SEMANTIC_IDENTIFIERS = new Set([
  'app',
  'component',
  'container',
  'content',
  'element',
  'root',
  'view',
  'wrapper'
])

const ACTION_WORDS = new Set([
  'accept',
  'add',
  'back',
  'cancel',
  'clear',
  'close',
  'confirm',
  'copy',
  'create',
  'delete',
  'download',
  'edit',
  'export',
  'import',
  'next',
  'open',
  'pause',
  'play',
  'remove',
  'retry',
  'save',
  'search',
  'select',
  'send',
  'share',
  'stop',
  'submit',
  'toggle',
  'upload'
])

const FIELD_TAGS = new Set(['input', 'select', 'textarea'])
const MEDIA_TAGS = new Set(['audio', 'canvas', 'img', 'picture', 'svg', 'video'])
const REGION_TAGS = new Set(['article', 'aside', 'footer', 'header', 'main', 'nav', 'section'])

export function stableHash(value: string, length = 16): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

export function normalizeSourceFile(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}

export function identifierWords(value: string): string[] {
  return value
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z\d]+/)
    .filter(Boolean)
}

function unique(words: string[]): string[] {
  return words.filter((word, index) => word && words.indexOf(word) === index)
}

function normalizedHint(value: string | undefined): string[] {
  if (!value) return []
  return identifierWords(value).filter((word) => !NON_SEMANTIC_IDENTIFIERS.has(word))
}

function sourceDomain(sourceFile: string): string[] {
  const path = sourceFile.replace(/\.(?:html|jsx|tsx)$/, '').split('/')
  const meaningful = path.flatMap(identifierWords).filter((word) => !NON_SEMANTIC_PATH_SEGMENTS.has(word))
  return unique(meaningful).slice(-3)
}

function actionFromHints(hints: string[]): string | undefined {
  return hints.find((word) => ACTION_WORDS.has(word))
}

export interface SemanticIdInput {
  component: string
  element: string
  handler?: string
  htmlId?: string
  name?: string
  part?: string
  sourceFile: string
  testId?: string
  type?: string
}

export function inferSemanticId(input: SemanticIdInput): string {
  const component = normalizedHint(input.component)
  const part = normalizedHint(input.part)
  const explicit = normalizedHint(input.testId ?? input.htmlId ?? input.name)
  const handler = normalizedHint(input.handler).filter((word) => !['handle', 'on'].includes(word))
  const type = normalizedHint(input.type)
  const element = identifierWords(input.element).at(-1) ?? 'element'
  const domain = sourceDomain(input.sourceFile)
  const hints = unique([...part, ...explicit, ...handler, ...component, ...type])
  const action = actionFromHints(hints)

  let role: string[]
  if (element === 'button' || action || component.includes('button')) {
    role = ['action', action ?? explicit.at(-1) ?? handler.at(-1) ?? component.at(-1) ?? 'button']
  } else if (FIELD_TAGS.has(element) || component.some((word) => ['input', 'select', 'textarea'].includes(word))) {
    role = ['field', explicit.at(-1) ?? component.at(-1) ?? element]
  } else if (MEDIA_TAGS.has(element)) {
    role = ['media', element]
  } else if (element === 'li') {
    role = ['item', ...part.slice(-1)]
  } else if (element === 'ol' || element === 'ul') {
    role = ['list', ...part.slice(-1)]
  } else if (/^h[1-6]$/.test(element)) {
    role = ['heading', element]
  } else if (REGION_TAGS.has(element)) {
    role = ['region', ...part.slice(-1), element]
  } else if (part.length > 0) {
    role = part
  } else {
    role = ['element', element]
  }

  const entity = component.filter((word) => !role.includes(word)).slice(-2)
  const prefix = domain.length > 0 ? domain : ['ui']
  return unique([...prefix, ...entity, ...role]).join('.')
}

export function createDescriptorHashes(input: {
  component: string
  element: string
  occurrence: number
  parentSemanticId?: string
  semanticId: string
  signature: string
  sourceFile: string
}): Pick<UiNodeDescriptor, 'anchorHash' | 'fingerprintHash'> {
  const anchor = [
    input.sourceFile,
    input.component,
    input.semanticId,
    input.element,
    input.signature,
    input.parentSemanticId ?? '',
    input.occurrence
  ].join('\0')
  const parentRole = input.parentSemanticId?.split('.').slice(-3).join('.') ?? ''
  const fingerprint = [input.component, input.element, input.signature, parentRole].join('\0')

  return {
    anchorHash: stableHash(anchor, 24),
    fingerprintHash: stableHash(fingerprint, 24)
  }
}
