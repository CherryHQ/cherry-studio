import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const output = join(root, '.context/cherry-cloud-verification/mutations')
mkdirSync(output, { recursive: true })
const pending = join(output, 'pending.json')
assert.ok(!existsSync(pending), `Unfinished mutation: inspect ${pending} and its original backup before continuing.`)
const commands = {
  contracts: ['node', '.agents/skills/verify-cherry-cloud/scripts/contracts.mjs'],
  ownership: ['node', '.agents/skills/verify-cherry-cloud/scripts/ownership.mjs'],
  refresh: [
    'pnpm',
    'exec',
    'vitest',
    'run',
    '--project',
    'main',
    'src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts',
    '-t',
    'settles queued full refreshes'
  ],
  native: [
    'pnpm',
    'test:agent-runtime-claude-code',
    'packages/agent-runtime-claude-code/tests/runtime.test.ts',
    '-t',
    'recovers real CLI API rejection identity'
  ],
  queue: ['pnpm', 'test:renderer', 'src/renderer/components/composer/__tests__/followupQueueCache.test.tsx'],
  portal: [
    'pnpm',
    'exec',
    'vitest',
    'run',
    '--project',
    'main',
    'src/main/services/cherryCloud/__tests__/CherryCloudService.test.ts',
    '-t',
    'opens only a live managed sender'
  ],
  intents: [
    'pnpm',
    'test:renderer',
    'src/renderer/services/__tests__/CherryCloudSubscriptionService.exhaustive.test.ts'
  ],
  targets: ['pnpm', 'test:renderer', 'src/renderer/utils/__tests__/cherryCloudTargetAdvice.exhaustive.test.ts']
}
function replaceOnce(before, after) {
  return (source) => {
    assert.equal(source.split(before).length, 2, `mutation anchor must occur once: ${before}`)
    return source.replace(before, after)
  }
}
function methodBody(className, methodName, body) {
  return (text) => {
    const source = ts.createSourceFile('mutation.ts', text, ts.ScriptTarget.Latest, true)
    const declaration = source.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === className)
    const method = declaration?.members.find(
      (node) => ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === methodName
    )
    assert.ok(method?.body, `missing ${className}.${methodName}`)
    return text.slice(0, method.body.getStart(source)) + body + text.slice(method.body.end)
  }
}
const cloud = 'src/main/services/cherryCloud/CherryCloudService.ts'
const intent = 'src/renderer/services/CherryCloudSubscriptionService.ts'
const target = 'src/renderer/utils/cherryCloudTargetAdvice.ts'
const cases = [
  {
    name: 'incomplete-receipt',
    file: cloud,
    check: 'refresh',
    mutate: replaceOnce(
      "let succeeded = results.every((result) => result.status === 'fulfilled')",
      "let succeeded = results.some((result) => result.status === 'fulfilled')"
    )
  },
  {
    name: 'native-cold-rejection',
    file: 'packages/agent-runtime-claude-code/src/projection.ts',
    check: 'native',
    mutate: replaceOnce('entry.isApiErrorMessage === true', 'false')
  },
  {
    name: 'edited-target-wakeup',
    file: 'src/renderer/components/composer/useFollowupQueue.ts',
    check: 'queue',
    mutate: replaceOnce('delete deferred[taken.item.id]', 'void deferred[taken.item.id]')
  },
  {
    name: 'stale-account-portal',
    file: cloud,
    check: 'portal',
    mutate: methodBody('CherryCloudService', 'isCurrentScope', '{ return true }')
  },
  {
    name: 'shared-login-cancel',
    file: intent,
    check: 'intents',
    mutate: replaceOnce(
      'this.disposed = true',
      "void ipcApi.request('cherry_cloud.login.cancel'); this.disposed = true"
    )
  },
  {
    name: 'security-primitive',
    file: 'src/main/services/cherryCloud/crypto.ts',
    check: 'contracts',
    mutate: replaceOnce("createHash('sha256').update(codeVerifier", "createHash('sha512').update(codeVerifier")
  },
  {
    name: 'external-schema',
    file: 'src/shared/ipc/schemas/cherryCloud.ts',
    check: 'contracts',
    mutate: replaceOnce("'selector_locked_row'", "'selector_wrong_row'")
  },
  {
    name: 'authorization-wire',
    file: cloud,
    check: 'contracts',
    mutate: replaceOnce("code_challenge_method: 'S256'", "code_challenge_method: 'S512'")
  },
  {
    name: 'security-method',
    file: cloud,
    check: 'contracts',
    mutate: methodBody('CherryCloudService', 'signedFetch', "{ throw new Error('broken signed request') }")
  },
  {
    name: 'entitlement-projection',
    file: cloud,
    check: 'contracts',
    mutate: methodBody(
      'CherryCloudService',
      'projectEntitledModels',
      '{ return { entitledModelIds: [], freeModelIds: [], availableModelIds: { general: [], agent: [] }, quotaExhaustedModelIds: [] } }'
    )
  },
  {
    name: 'domain-boundary',
    file: 'src/renderer/components/ModelSelector/types.ts',
    check: 'ownership',
    mutate: (source) => source + "\nexport const brokenCloudPolicy = 'CherryCloud'\n"
  },
  {
    name: 'latest-intent',
    file: intent,
    check: 'intents',
    mutate: methodBody('CherryCloudSubscriptionService', 'isCurrentIntent', '{ return !this.disposed }')
  },
  {
    name: 'window-disposal',
    file: intent,
    check: 'intents',
    mutate: methodBody('CherryCloudSubscriptionService', 'dispose', '{}')
  },
  {
    name: 'duplicate-portal',
    file: intent,
    check: 'intents',
    mutate: replaceOnce(
      'const result = await openCherryCloudAccountPortal({ scopeId, entrySource: intent.source, flowId: intent.flowId })',
      'await openCherryCloudAccountPortal({ scopeId, entrySource: intent.source, flowId: intent.flowId });\n      const result = await openCherryCloudAccountPortal({ scopeId, entrySource: intent.source, flowId: intent.flowId })'
    )
  },
  { name: 'stale-quota', file: target, check: 'targets', mutate: replaceOnce("facts.freshness !== 'fresh'", 'false') },
  {
    name: 'other-provider-quota',
    file: target,
    check: 'targets',
    mutate: replaceOnce('!isManagedCherryCloudModel(providerId)', 'false')
  },
  {
    name: 'dropped-second-target',
    file: target,
    check: 'targets',
    mutate: replaceOnce('return advice?.some(', 'return advice?.slice(0, 1).some(')
  }
]
function run(key, label) {
  const [command, ...args] = commands[key]
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 60_000 })
  if (result.error) throw result.error
  const log = result.stdout + result.stderr
  writeFileSync(join(output, `${label}.log`), log)
  return { status: result.status, log }
}
if (process.argv.length !== 2) throw new Error('Run without arguments, only when all source writers are idle.')
for (const key of Object.keys(commands)) {
  assert.equal(run(key, `control-${key}`).status, 0, `${key}: control must pass before mutation`)
}
for (const mutation of cases) {
  const file = join(root, mutation.file)
  const original = readFileSync(file, 'utf8')
  const broken = mutation.mutate(original)
  assert.notEqual(broken, original, `${mutation.name}: mutation did not change real code`)
  const backup = join(output, `${mutation.name}.original`)
  writeFileSync(backup, original)
  writeFileSync(pending, JSON.stringify({ file, backup, mutation: mutation.name }, null, 2))
  writeFileSync(file, broken)
  try {
    const result = run(mutation.check, mutation.name)
    assert.notEqual(result.status, 0, `${mutation.name}: checker missed the real-code break`)
    assert.match(
      result.log,
      /AssertionError|AssertionError\[|expected .* to /,
      `${mutation.name}: failed without a property counterexample`
    )
    process.stdout.write(`Detected ${mutation.name}.\n`)
  } finally {
    assert.equal(readFileSync(file, 'utf8'), broken, `${mutation.name}: concurrent edit; refusing to overwrite it`)
    writeFileSync(file, original)
    unlinkSync(pending)
  }
}
for (const key of Object.keys(commands)) {
  assert.equal(run(key, `restored-${key}`).status, 0, `${key}: restored real code must pass`)
}
process.stdout.write(`Detected all ${cases.length} deliberate breaks; restored controls pass. Logs: ${output}\n`)
