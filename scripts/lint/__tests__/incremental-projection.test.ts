import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { expect, it } from 'vitest'

it('restricts the installed live writers and selectors while permitting recovery in its own method', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const directory = mkdtempSync(join(tmpdir(), 'cherry-projection-lint-'))
  const files = {
    'packages/agent-runtime/src/observation.ts':
      'class Feed { publishPart(e) { return this.helper(e) } helper(e) { return this.message(e.ref.id) } recover() { return this.snapshot } } export { Feed }',
    'packages/agent-runtime/src/stagePartUpdate.ts': 'export { history as accepted } from "./coldHelper"',
    'packages/agent-runtime-pi/src/runtimeProjection.ts': 'export class Pi { delta() { return this.feed.snapshot } }',
    'packages/agent-runtime-claude-code/src/projection.ts':
      'export class Claude { partial() { return this.readMessage() } }',
    'packages/agent-runtime-pi-durable/src/projection.ts':
      'export class Durable { updatePreviewParts() { return this.feed.messageIds } }',
    'packages/agent-runtime-claude-code/src/observation.ts':
      'export class ClaudeFeed { publish() { return this.snapshot } }',
    'src/main/ai/agentSession/ThreadMessageProjection.ts':
      'export class Thread { stageParts() { return this.snapshot() } }',
    'src/main/ai/streamManager/TopicMessageProjection.ts':
      'export class Topic { relayAgentPart() { return this.owner.readMessage() } }',
    'src/main/ai/agentSession/RootMessageProjection.ts':
      'export class Root { changePart() { return this.replyEntries() } }',
    'src/main/ai/agentSession/ChildThreadProjection.ts':
      'export class Child { applyParts() { return this.delivery.snapshot() } }',
    'src/renderer/hooks/useHistoryRowUpdates.ts': 'export function update(row) { return row.mutate() }',
    'src/renderer/hooks/useHistoryReplies.ts':
      'import { useConversationHistoryQuery as reload } from "./useConversationHistoryQuery"; export { reload }',
    'src/renderer/hooks/agent/useProjectionPart.ts': 'import { readAll as alias } from "./history"; export { alias }',
    'src/renderer/services/aiTransport/MessageProjectionService.ts':
      'export class Store { commitParts() { return this.bulk() } bulk() { return this.row.forEachPart(fn) } }',
    'src/renderer/components/chat/messages/blocks/MessagePartsRenderer.tsx':
      'export function useAddressedMessageParts() { return projectLiveMessageParts(row) }',
    'src/renderer/services/aiTransport/applyLiveParts.ts':
      'import { type MessageProjectionView as Page } from "@shared/ai/messageProjection"; export type { Page }'
  }
  try {
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'))
    symlinkSync(join(root, 'scripts'), join(directory, 'scripts'))
    writeFileSync(join(directory, '.oxlintrc.json'), readFileSync(join(root, '.oxlintrc.json')))
    for (const [file, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, file)), { recursive: true })
      writeFileSync(join(directory, file), contents)
    }
    const result = spawnSync(join(root, 'node_modules/.bin/oxlint'), ['--format', 'json', ...Object.keys(files)], {
      cwd: directory,
      encoding: 'utf8'
    })
    const { diagnostics } = JSON.parse(result.stdout) as {
      diagnostics: { filename: string; code: string; message: string }[]
    }
    const missing = diagnostics.filter((d) => d.message.startsWith('Configured live writer'))
    expect(missing.some((d) => d.message.includes('AddressedProcessHistory'))).toBe(true)
    const restricted = diagnostics.filter((d) => !missing.includes(d))
    expect(restricted.map((d) => d.filename).sort()).toEqual(Object.keys(files).sort())
    expect(restricted.filter((d) => d.code.includes('addressed-writes'))).toHaveLength(11)
    expect(result.status).toBe(1)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
})

it('keeps the production paths covered by the incremental guards', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const { config, error } = ts.readConfigFile(join(root, '.oxlintrc.json'), ts.sys.readFile)
  expect(error).toBeUndefined()
  for (const override of config.overrides) {
    if (!override.rules?.['incremental-projection/addressed-writes']) continue
    for (const file of override.files) expect(existsSync(join(root, file)), file).toBe(true)
  }
})
