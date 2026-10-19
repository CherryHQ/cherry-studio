import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint()
const GUARDS = new Set([
  '@typescript-eslint/no-restricted-imports',
  'no-restricted-syntax',
  'no-restricted-globals',
  'no-restricted-properties',
  'barrel/closed'
])

async function guardHits(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: file })
  expect(result.messages.filter((message) => message.fatal)).toEqual([])
  return result.messages
    .filter((message) => message.severity === 2 && GUARDS.has(message.ruleId ?? ''))
    .map((message) => message.ruleId ?? '')
}

const SRC = 'packages/agent-behavior/src'
const IMPORTS = '@typescript-eslint/no-restricted-imports'
const SYNTAX = 'no-restricted-syntax'
const GLOBALS = 'no-restricted-globals'

const LAYERS = ['core', 'ports', 'orchestration', 'contract', 'fake']
const PACKAGE_BANS: readonly (readonly [string, string, string])[] = [
  ['node', `import { readFile } from 'node:fs'\nexport { readFile }`, IMPORTS],
  ['bare builtin', `import { createHash } from 'crypto'\nexport { createHash }`, IMPORTS],
  ['pi', `import { Type } from '@earendil-works/pi-ai'\nexport { Type }`, IMPORTS],
  ['electron', `import { app } from 'electron'\nexport { app }`, IMPORTS],
  ['main', `import { x } from '@main/utils/file'\nexport { x }`, IMPORTS],
  ['shared', `import { x } from '@shared/ai/piBuiltinTools'\nexport { x }`, IMPORTS],
  ['logger', `import { loggerService } from '@logger'\nexport { loggerService }`, IMPORTS],
  ['application', `import { application } from '@application'\nexport { application }`, IMPORTS],
  ['ai sdk', `import { generateText } from 'ai'\nexport { generateText }`, IMPORTS],
  ['ai provider', `import { openai } from '@ai-sdk/openai'\nexport { openai }`, IMPORTS],
  ['adapter', `import { x } from '@cherrystudio/agent-runtime-pi'\nexport { x }`, IMPORTS],
  ['runtime value', `import { runtimeId } from '@cherrystudio/agent-runtime'\nexport { runtimeId }`, IMPORTS],
  [
    'runtime protocol type',
    `import type { MessageItem } from '@cherrystudio/agent-runtime'\nexport type { MessageItem }`,
    SYNTAX
  ],
  ['runtime namespace', `import type * as Runtime from '@cherrystudio/agent-runtime'\nexport type { Runtime }`, SYNTAX]
]

describe('agent-behavior boundary guards', () => {
  // Catches a layer block that drops a package-level ban: each layer rewrites the import rule (flat config is last-wins).
  it.each(
    LAYERS.flatMap((layer) => PACKAGE_BANS.map(([name, code, rule]) => [`${name} in ${layer}`, layer, code, rule]))
  )('fires on %s', async (_name, layer, code, rule) => {
    expect(await guardHits(`${SRC}/${layer}/probe.ts`, code)).toContain(rule)
  })

  // Catches a guard that silently stops firing (flat-config last-wins override, a glob typo), letting harness, host
  // or environment code into a package that must run unchanged on coding-agent, Durable and the fake.
  it.each([
    [
      'adapter deep import',
      'packages/agent-runtime-pi/src/probe.ts',
      `import { ENTRY_KINDS } from '@cherrystudio/agent-behavior/core/facts'\nexport { ENTRY_KINDS }`,
      'barrel/closed'
    ],
    [
      'core → ports',
      `${SRC}/core/probe.ts`,
      `import type { Ledger } from '../ports/harness'\nexport type { Ledger }`,
      IMPORTS
    ],
    [
      'core → orchestration',
      `${SRC}/core/goal/probe.ts`,
      `import { x } from '../../orchestration/gate'\nexport { x }`,
      IMPORTS
    ],
    ['core → fake', `${SRC}/core/probe.ts`, `import { x } from '../fake/fakeHarness'\nexport { x }`, IMPORTS],
    ['core → contract', `${SRC}/core/probe.ts`, `import { x } from '../contract/cases'\nexport { x }`, IMPORTS],
    ['core → barrel', `${SRC}/core/probe.ts`, `import { x } from '..'\nexport { x }`, IMPORTS],
    // Catches core reaching the barrel through a file path, which the bare-directory pattern missed.
    ['core → barrel file', `${SRC}/core/probe.ts`, `import { x } from '../index.js'\nexport { x }`, IMPORTS],
    // Catches core reading the host's locale or time zone, which makes keys and decisions differ between machines.
    [
      'core Intl',
      `${SRC}/core/probe.ts`,
      `export const zone = () => new Intl.DateTimeFormat().resolvedOptions()`,
      GLOBALS
    ],
    [
      'core localeCompare',
      `${SRC}/core/probe.ts`,
      `export const cmp = (a: string, b: string) => a.localeCompare(b)`,
      SYNTAX
    ],
    ['core toLocale', `${SRC}/core/probe.ts`, `export const show = (n: number) => n.toLocaleString()`, SYNTAX],
    ['core Date', `${SRC}/core/probe.ts`, `export const at = () => Date.now()`, GLOBALS],
    ['core Math.random', `${SRC}/core/probe.ts`, `export const roll = () => Math.random()`, 'no-restricted-properties'],
    ['core crypto', `${SRC}/core/probe.ts`, `export const id = () => crypto.randomUUID()`, GLOBALS],
    ['core performance', `${SRC}/core/probe.ts`, `export const t = () => performance.now()`, GLOBALS],
    ['core process', `${SRC}/core/probe.ts`, `export const env = () => process.env.HOME`, GLOBALS],
    ['core timer', `${SRC}/core/probe.ts`, `export const later = (f: () => void) => setTimeout(f, 1)`, GLOBALS],
    ['core microtask', `${SRC}/core/probe.ts`, `export const soon = (f: () => void) => queueMicrotask(f)`, GLOBALS],
    ['core fetch', `${SRC}/core/probe.ts`, `export const get = () => fetch('https://example.com')`, GLOBALS],
    ['core globalThis', `${SRC}/core/probe.ts`, `export const g = () => globalThis`, GLOBALS],
    ['core async', `${SRC}/core/probe.ts`, `export async function f(): Promise<number> { return 1 }`, SYNTAX],
    ['core await', `${SRC}/core/probe.ts`, `export const f = async (p: PromiseLike<number>) => await p`, SYNTAX],
    ['core Promise type', `${SRC}/core/probe.ts`, `export type Later = Promise<number>`, SYNTAX],
    ['core yield', `${SRC}/core/probe.ts`, `export function* f() { yield 1 }`, SYNTAX],
    ['core key cast', `${SRC}/core/probe.ts`, `import type { Key } from './keys'\nexport const k = 'x' as Key`, SYNTAX],
    ['ports runtime code', `${SRC}/ports/probe.ts`, `export function f() { return 1 }`, SYNTAX],
    [
      'ports value import',
      `${SRC}/ports/probe.ts`,
      `import { ENTRY_KINDS } from '../core/facts'\nexport type K = typeof ENTRY_KINDS`,
      SYNTAX
    ],
    // Catches ports/ reaching the barrel through a file path, which the bare-directory pattern missed.
    [
      'ports → barrel file',
      `${SRC}/ports/probe.ts`,
      `import type { X } from '../index.js'\nexport type { X }`,
      IMPORTS
    ],
    [
      'ports → fake',
      `${SRC}/ports/probe.ts`,
      `import type { FakeHarness } from '../fake/fakeHarness'\nexport type { FakeHarness }`,
      IMPORTS
    ],
    [
      'orchestration module let',
      `${SRC}/orchestration/probe.ts`,
      `let count = 0\nexport const next = () => ++count`,
      SYNTAX
    ],
    [
      'orchestration new Promise',
      `${SRC}/orchestration/probe.ts`,
      `export const wait = () => new Promise<void>((r) => r())`,
      SYNTAX
    ],
    [
      'orchestration timer',
      `${SRC}/orchestration/probe.ts`,
      `export const later = (f: () => void) => setInterval(f, 1)`,
      GLOBALS
    ],
    [
      'orchestration key cast',
      `${SRC}/orchestration/probe.ts`,
      `import type { Key } from '../core/keys'\nexport const k = 'x' as unknown as Key`,
      SYNTAX
    ],
    // Catches module state behind a `const`, with or without a type assertion, and classes with instance state, which
    // the `let` ban misses (AC3, Stage A review M5).
    [
      'orchestration module collection',
      `${SRC}/orchestration/probe.ts`,
      `const seen = new Map<string, number>()\nexport const mark = (key: string) => seen.set(key, 1)`,
      SYNTAX
    ],
    [
      'orchestration module collection behind an assertion',
      `${SRC}/orchestration/probe.ts`,
      `const seen = new Map() as Map<string, number>\nexport const mark = (key: string) => seen.set(key, 1)`,
      SYNTAX
    ],
    // Catches a promise made by hand through `withResolvers`, which the `new Promise` ban misses.
    [
      'orchestration promise resolvers',
      `${SRC}/orchestration/probe.ts`,
      `export function wait() {\n  const { promise } = Promise.withResolvers<void>()\n  return promise\n}`,
      SYNTAX
    ],
    [
      'orchestration class',
      `${SRC}/orchestration/probe.ts`,
      `export class Driver {\n  runs = 0\n  next() {\n    return ++this.runs\n  }\n}`,
      SYNTAX
    ],
    // Catches orchestration/ reaching the barrel through a file path, which the bare-directory pattern missed.
    [
      'orchestration → barrel file',
      `${SRC}/orchestration/probe.ts`,
      `import { x } from '../index.js'\nexport { x }`,
      IMPORTS
    ],
    [
      'orchestration → fake',
      `${SRC}/orchestration/probe.ts`,
      `import { x } from '../fake/fakeHarness'\nexport { x }`,
      IMPORTS
    ],
    // Catches contract cases depending on the fake or on orchestration, so they would stop being harness-neutral.
    ['contract → fake', `${SRC}/contract/probe.ts`, `import { x } from '../fake/fakeHarness'\nexport { x }`, IMPORTS],
    [
      'contract → orchestration',
      `${SRC}/contract/probe.ts`,
      `import { x } from '../orchestration/gate'\nexport { x }`,
      IMPORTS
    ]
  ])('fires on %s', async (_name, file, code, rule) => {
    expect(await guardHits(file, code)).toContain(rule)
  })

  // Catches a guard so broad it blocks the sanctioned shapes (type-only id imports, pure sync core, interface-only
  // ports, function-scoped let), which would push people to disable it.
  it.each([
    [
      `${SRC}/core/probe.ts`,
      `import type { ItemId, ThreadId } from '@cherrystudio/agent-runtime'\nexport type Pair = [ThreadId, ItemId]\nexport const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)`
    ],
    [
      `${SRC}/ports/probe.ts`,
      `import type { ThreadId } from '@cherrystudio/agent-runtime'\nexport interface Reader {\n  read(thread: ThreadId): Promise<number>\n}`
    ],
    [
      `${SRC}/orchestration/probe.ts`,
      `export const SCHEMA = { type: 'object' }\nexport const fresh = () => new AbortController().signal\nexport function count(xs: readonly number[]) {\n  let n = 0\n  for (const x of xs) n += x\n  return n\n}`
    ],
    [
      `${SRC}/contract/probe.ts`,
      `import type { Key } from '../core/keys'\nexport const k = (label: string) => \`contract:\${label}\` as Key\nexport const wait = () => new Promise<void>((r) => r())`
    ]
  ])('allows the sanctioned shape in %s', async (file, code) => {
    expect(await guardHits(file, code)).toEqual([])
  })
})
