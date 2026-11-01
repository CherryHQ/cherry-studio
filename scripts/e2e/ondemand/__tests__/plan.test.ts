import { readRequest, parsePlan, scenarioPath } from '../plan'

// Catch dispatch typos and executable inputs before allocating a desktop runner.
it.each([
  { steps: [] },
  { steps: [{ verb: 'script', script: 'process.exit(0)' }] },
  { steps: [{ verb: 'expectStatus', script: '1' }] },
  { steps: [{ verb: 'click', text: '翻译', script: '1' }] },
  { steps: [{ verb: 'screenshot', name: '../escape' }] },
  { steps: [{ verb: 'sleep', ms: -1 }] },
  { steps: [{ verb: 'click', text: '翻译' }], requiredTimezone: 'not-a-timezone' }
])('rejects an invalid data-only plan: %j', (input) => {
  expect(() => parsePlan(JSON.stringify(input))).toThrow()
})

it('counts the UTF-8 bytes of Chinese input, including the exact boundary', () => {
  const prefix = JSON.stringify({ steps: [{ verb: 'expectText', text: '中' }] })
  const exact = prefix + ' '.repeat(10_240 - Buffer.byteLength(prefix))
  expect(parsePlan(exact).steps[0]).toEqual({ verb: 'expectText', text: '中' })
  expect(() => parsePlan(exact + ' ')).toThrow('10,240 UTF-8 bytes')
})

it('accepts a temporary plan without any matching spec file', () => {
  const request = readRequest({ QA_SPEC: 'temporary-no-file', QA_PLAN: '{"steps":[{"verb":"click","text":"翻译"}]}' })
  expect(request.file).toBeNull()
  expect(request.plan?.continueOnFailure).toBe(false)
})

it('defaults to clean and requires an explicit authenticated profile', () => {
  expect(readRequest({}).profile).toBe('clean')
  expect(readRequest({ QA_PROFILE: 'authenticated' }).profile).toBe('authenticated')
  expect(() => readRequest({ QA_PROFILE: 'developer' })).toThrow()
})

it.each(['../escape', 'UPPER', 'a/b', 'a\\b', 'a'.repeat(42)])('rejects unsafe report names %s', (name) => {
  expect(() => readRequest({ QA_SPEC: name })).toThrow()
  expect(() => scenarioPath(name)).toThrow()
})

it.each(['5', '14', '360.1', 'NaN', '361'])('rejects invalid branch budgets %s', (value) => {
  expect(() => readRequest({ QA_TIMEOUT_MINUTES: value })).toThrow()
})

it('accepts the branch minimum and the distinct tag minimum', () => {
  expect(readRequest({ QA_TIMEOUT_MINUTES: '15' }).timeoutMinutes).toBe(15)
  expect(readRequest({ QA_MODE: 'tag', QA_TIMEOUT_MINUTES: '1' }).timeoutMinutes).toBe(1)
  expect(readRequest({}).plan?.steps.some((step) => step.verb === 'expectVisible')).toBe(true)
})
