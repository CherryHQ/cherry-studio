import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

function lint(source: string, rule?: string) {
  const file = join(directory, 'probe.ts')
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
    [binary, '--config', selectedConfig, '--format', 'json', '--deny-warnings', file],
    {
      encoding: 'utf8'
    }
  )

  if (result.error) throw result.error

  return { status: result.status, ...JSON.parse(result.stdout) }
}

describe('available generic anti-slop rules', () => {
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
})
