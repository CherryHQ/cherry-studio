import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const binary = join(dirname(require.resolve('oxlint/package.json')), 'bin/oxlint')
const config = fileURLToPath(new URL('../../../.oxlintrc.json', import.meta.url))
const directory = mkdtempSync(join(tmpdir(), 'cherry-anti-slop-'))

afterAll(() => rmSync(directory, { recursive: true, force: true }))

function lint(source: string, rule?: string, filename = 'probe.ts') {
  const file = join(directory, filename)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, source)

  const selectedConfig = rule ? join(directory, 'rule.config.json') : config
  if (rule) {
    writeFileSync(
      selectedConfig,
      JSON.stringify({
        extends: [config],
        rules: { [rule === 'no-accumulating-spread' ? `oxc/${rule}` : `anti-slop/${rule}`]: 'error' }
      })
    )
  }
  const result = spawnSync(
    process.execPath,
    [binary, '--config', selectedConfig, '--format', 'json', '--deny-warnings', '--no-ignore', file],
    {
      encoding: 'utf8'
    }
  )

  if (result.error) throw result.error

  return { status: result.status, ...JSON.parse(result.stdout) }
}

describe('available generic anti-slop rules', () => {
  it.each([
    ['no-reflect-apply', 'export const result = Reflect.apply(Math.max, undefined, [1, 2])'],
    ['no-reflect-get', 'export const result = Reflect.get({ value: 1 }, "value")'],
    ['no-object-parameters', 'export function read(value: object) { return value }'],
    ['no-array-filter-map', 'export const result = [1, 2].filter(value => value > 0).map(value => value * 2)'],
    ['no-conditional-empty-object-spread', 'export const result = { ...(Math.random() > 0.5 ? { value: 1 } : {}) }'],
    ['no-accumulating-spread', 'export const result = [1, 2].reduce((acc, item) => [...acc, item], [] as number[])'],
    ['no-unknown-type-aliases', 'export type Boundary = unknown'],
    ['no-unknown-returns', 'export function read(): unknown { return "value" }'],
    ['no-unknown-parameters', 'export function read(value: unknown) { return value }'],
    ['no-chained-type-assertions', 'export const result = "value" as unknown as number'],
    [
      'no-widen-then-assert',
      'const known = "value"; const broad: unknown = known; export const result = broad as string'
    ],
    [
      'no-reduce-accumulator-copy',
      'export const result = [1, 2].reduce((acc, item) => acc.concat([item]), [] as number[])'
    ]
  ])('enforces %s in the repository gate after its cleanup', (rule, source) => {
    const result = lint(source)
    expect(result.status).toBe(1)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: `${rule === 'no-accumulating-spread' ? 'oxc' : 'anti-slop'}(${rule})`,
          severity: 'error'
        })
      ])
    )
  })

  it.each([
    ['no-array-filter-map', 'export const result = [1, 2].filter(value => value > 0).map(value => value * 2)'],
    [
      'no-reduce-accumulator-copy',
      'export const result = [1, 2].reduce((acc, item) => acc.concat([item]), [] as number[])'
    ],
    ['no-accumulating-spread', 'export const result = [1, 2].reduce((acc, item) => [...acc, item], [] as number[])'],
    ['no-chained-type-assertions', 'export const result = "value" as unknown as number'],
    ['no-conditional-empty-object-spread', 'export const result = { ...(Math.random() > 0.5 ? { value: 1 } : {}) }'],
    ['no-known-value-widening', 'export const result: unknown = "value"'],
    ['no-module-mocking', 'import { vi } from "vitest"; vi.mock("./dependency")'],
    ['no-object-parameters', 'export function read(value: object) { return value }'],
    ['no-reflect-apply', 'export const result = Reflect.apply(Math.max, undefined, [1, 2])'],
    ['no-reflect-get', 'export const result = Reflect.get({ value: 1 }, "value")'],
    ['no-runtime-typeof', 'export function read(value: string | number) { return typeof value === "string" }'],
    ['no-shape-in-symbol-names', 'export const userShape = { name: "user" }'],
    ['no-unknown-parameters', 'export function read(value: unknown) { return value }'],
    ['no-unknown-returns', 'export function read(): unknown { return "value" }'],
    ['no-unknown-type-aliases', 'export type Boundary = unknown'],
    ['no-unsafe-dictionary-type', 'export type Metadata = Record<string, unknown>'],
    [
      'no-widen-then-assert',
      'const known = "value"; const broad: unknown = known; export const result = broad as string'
    ],
    ['require-readable-spacing', 'export function first() { return 1 }\nexport function second() { return 2 }'],
    ['require-safety-comment-for-type-assertion', 'export const value = "value" as string']
  ])('rejects %s violations', (rule, source) => {
    const result = lint(source, rule)
    expect(result.status).toBe(1)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: expect.stringContaining(`(${rule})`), severity: 'error' })
      ])
    )
  })

  it.each([
    'export const result = [1, 2].flatMap(value => value > 0 ? [value * 2] : [])',
    'export const result = [1, 2].reduce((acc: number[], item) => { acc.push(item);\n\nreturn acc }, [])',
    'export const values = ["first", "second"] as const',
    'import { z } from "zod";\n\nexport const userSchema = z.object({ name: z.string() })',
    'export function read(value: { name: string }) { return value.name }',
    'export const available = typeof document !== "undefined"'
  ])('accepts supported code: %s', (source) => {
    const result = lint(source)
    expect(result.status).toBe(0)
    expect(result.diagnostics).toEqual([])
  })

  it.each([
    'probe.test.ts',
    'probe.spec.tsx',
    'probe.test.mts',
    '__tests__/helper.ts',
    '__mocks__/helper.ts',
    'scripts/e2e/regression/helper.ts',
    'scripts/utility-process-smoke/harness/helper.ts',
    'nested/tests/helper.ts'
  ])('exempts test code from anti-slop while retaining other lint rules in %s', (filename) => {
    const boundary = lint(
      `import { vi } from "vitest";
export type Boundary = unknown;
export type Metadata = Record<string, unknown>;
export function read(value: object): unknown { return value }
export function classify(value: string | number) { return typeof value === "string" }
export const result = "value" as unknown as number;
export const broad: unknown = "value";
export const reflected = Reflect.get({ value: 1 }, "value");
export const applied = Reflect.apply(Math.max, undefined, [1, 2]);
export const mapped = [1, 2].filter(value => value > 0).map(value => value * 2);
export const spread = { ...(Math.random() > 0.5 ? { value: 1 } : {}) };
export const copied = [1, 2].reduce((acc, item) => acc.concat([item]), [] as number[]);
export const accumulated = [1, 2].reduce((acc, item) => [...acc, item], [] as number[]);
vi.mock("./dependency");`,
      undefined,
      filename
    )
    expect(boundary.status).toBe(0)
    expect(boundary.diagnostics).toEqual([])

    const invalid = lint('export const result = eval("1")', undefined, filename)
    expect(invalid.status).toBe(1)
    expect(invalid.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'eslint(no-eval)', severity: 'error' })])
    )
  })
})
