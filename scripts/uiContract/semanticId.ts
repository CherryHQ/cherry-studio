import { relative, sep } from 'node:path'

const DOMAIN_ALIASES = new Map([
  ['composer', 'chat'],
  ['home', 'app'],
  ['layout', 'app'],
  ['main', 'app']
])
const COMPONENT_SUFFIXES = new Set([
  'component',
  'components',
  'container',
  'impl',
  'provider',
  'renderer',
  'root',
  'wrapper'
])
const COMPONENT_TECHNICAL_WORDS = new Set(['impl', 'renderer', 'runtime'])
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
const EVENT_PLUMBING_WORDS = new Set(['default', 'event', 'propagation'])
const LOW_INFORMATION_HINTS = new Set(['component', 'element', 'root'])
const SOURCE_MARKERS = new Set(['components', 'pages', 'windows'])

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

function normalizedHint(value: string | undefined): string {
  if (!value) return ''
  return identifierWords(value)
    .filter((word) => !LOW_INFORMATION_HINTS.has(word))
    .slice(0, 4)
    .join('-')
}

function sourceDomain(sourceFile: string): string {
  const path = sourceFile.split('/')
  if (sourceFile.startsWith('packages/ui/')) return 'ui'

  const markerIndex = path.findIndex((segment) => SOURCE_MARKERS.has(segment))
  const candidate = markerIndex === -1 ? undefined : path[markerIndex + 1]
  if (!candidate || /\.[jt]sx?$|\.html$/.test(candidate) || !/^[a-z]/.test(candidate)) return 'ui'

  const normalized = identifierWords(candidate).join('-')
  return DOMAIN_ALIASES.get(normalized) ?? normalized
}

function componentOwner(component: string, sourceFile: string): string {
  let words = identifierWords(component).filter((word) => !COMPONENT_TECHNICAL_WORDS.has(word))
  if (words[0] === 'use') words.shift()
  while (COMPONENT_SUFFIXES.has(words.at(-1) ?? '')) words.pop()
  if (words.length === 0) {
    const filename = sourceFile
      .split('/')
      .at(-1)
      ?.replace(/\.(?:html|jsx|tsx)$/, '')
    words = identifierWords(filename ?? '')
  }
  return unique(words).slice(0, 4).join('-') || 'surface'
}

function semanticBase(domain: string, owner: string): string {
  const domainWords = identifierWords(domain)
  const ownerWords = identifierWords(owner)
  while (domainWords.length > 0 && ownerWords[0] === domainWords[0]) {
    domainWords.shift()
    ownerWords.shift()
  }
  return ownerWords.length > 0 ? `${domain}.${ownerWords.join('-')}` : domain
}

function appendQualifier(base: string, qualifier: string | undefined): string {
  if (!qualifier) return base
  const owner = base.split('.').at(-1) ?? ''
  const ownerWords = new Set(identifierWords(owner))
  const qualifierWords = identifierWords(qualifier)
  if (qualifierWords.every((word) => ownerWords.has(word))) return base
  return `${base}.${qualifierWords.join('-')}`
}

export function inferHandlerAction(handler: string | undefined): string | undefined {
  const words = identifierWords(handler ?? '').filter((word) => !['handle', 'handler', 'on'].includes(word))
  if (words.some((word) => EVENT_PLUMBING_WORDS.has(word))) return undefined
  return words.find((word) => ACTION_WORDS.has(word))
}

export interface SemanticIdInput {
  component: string
  element: string
  handler?: string
  htmlId?: string
  isComponentRoot?: boolean
  name?: string
  part?: string
  role?: string
  sourceFile: string
  testId?: string
  type?: string
}

export function inferSemanticId(input: SemanticIdInput): string {
  const domain = sourceDomain(input.sourceFile)
  const owner = componentOwner(input.component, input.sourceFile)
  const base = semanticBase(domain, owner)
  const action = inferHandlerAction(input.handler)
  if (action && !input.isComponentRoot) return `${base}.action.${action}`

  const stableAttribute = [input.testId, input.htmlId, input.name].map((value) => normalizedHint(value)).find(Boolean)
  const authoredRole =
    normalizedHint(input.part) ||
    normalizedHint(input.role) ||
    stableAttribute ||
    (!input.isComponentRoot ? normalizedHint(input.type) : '')
  return appendQualifier(base, authoredRole)
}
