import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..')
const PROBE = join(PKG, 'src/core/__probe__.ts')

function diagnose(code: string): string[] {
  const { config, error } = ts.readConfigFile(join(PKG, 'tsconfig.core.json'), ts.sys.readFile)
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'))
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, PKG)
  const host = ts.createCompilerHost(options)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  host.readFile = (file) => (file === PROBE ? code : readFile(file))
  host.fileExists = (file) => file === PROBE || fileExists(file)
  const program = ts.createProgram({ rootNames: [PROBE], options, host })
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

describe('core tsconfig', () => {
  // Catches the core config inheriting Node or DOM ambient types (e.g. `types: ["node"]` from the base config), which
  // would let core compile against host globals that lint only checks in value positions.
  it.each([
    ['process', 'export const home = process.env.HOME'],
    ['setTimeout', 'export const later = (f: () => void) => setTimeout(f, 1)'],
    ['AbortSignal', 'export type Cancel = AbortSignal'],
    ['TextEncoder', 'export const bytes = new TextEncoder().encode("x")']
  ])('has no %s', (name, code) => {
    expect(diagnose(code).some((m) => m.includes(`Cannot find name '${name}'`))).toBe(true)
  })

  // Catches a broken core config (bad extends, missing lib) that would make the checks above pass for the wrong reason.
  it('compiles plain ES code', () => {
    expect(diagnose('export const total: number = [1, 2, 3].reduce((sum, n) => sum + n, 0)')).toEqual([])
  })
})
