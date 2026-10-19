import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, expectTypeOf, it } from 'vitest'

import { HARNESS_PORT_METHODS } from '../../src/contract/portMethods'
import { keys } from '../../src/core/keys'
import type { HostPorts } from '../../src/ports/host'

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
const sources = (dir: string, except = '') =>
  files(fileURLToPath(new URL(dir, import.meta.url)))
    .filter((path) => except === '' || !path.endsWith(except))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
const orchestration = sources('../../src/orchestration/')
const writers = `${sources('../../src/core/', 'keys.ts')}\n${orchestration}`

type HostPortMethod = { [P in keyof HostPorts]: `${P}.${Extract<keyof HostPorts[P], string>}` }[keyof HostPorts]
const HOST_PORT_METHODS = [
  'approvals.facts',
  'approvals.ask',
  'approvals.outcomes',
  'questions.ask',
  'models.find',
  'models.current',
  'verifier.verify',
  'outputStore.save',
  'summarizer.summarize',
  'observation.emit',
  'settings.goalDefaults',
  'settings.autonomy',
  'settings.permissionMode',
  'settings.attendance',
  'settings.maxBackground',
  'settings.offloadThreshold'
] as const satisfies readonly HostPortMethod[]
const called = (method: string) => {
  const [port, name] = method.split('.')
  return new RegExp(`\\b${port}\\s*\\.\\s*${name}\\(`)
}

describe('port usage (guardrail 2)', () => {
  // Catches a host port method added without being listed here, which would escape the check below.
  it('lists every host port method', () => {
    expectTypeOf<Exclude<HostPortMethod, (typeof HOST_PORT_METHODS)[number]>>().toEqualTypeOf<never>()
  })

  // Catches a port method no orchestration code calls: every adapter would implement and test an unused operation.
  it.each([...HARNESS_PORT_METHODS, ...HOST_PORT_METHODS])('orchestration calls %s', (method) => {
    expect(orchestration).toMatch(called(method))
  })

  // Catches a key format nothing derives any more, which adapters and the README would still carry (Stage C Task 1).
  it.each(Object.keys(keys))('a rule or the orchestration derives keys.%s', (name) => {
    expect(writers).toMatch(new RegExp(`\\bkeys\\.${name}\\(`))
  })
})
