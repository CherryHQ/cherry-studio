import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { InMemory, resolveMountConfig, vfs } from '@zenfs/core'

import { application } from '@application'

// The Cherry Assistant files the desktop ships in its app resources: the definition the agent prompt
// reads and the persona and memory files copied into the agent's data folder. Its Claude plugin is left out.
const templates = import.meta.glob<string>(
  [
    '../../../../resources/builtin-agents/cherry-assistant/{agent.json,SOUL.md,USER.md}',
    '../../../../resources/builtin-agents/cherry-assistant/memory/*.md'
  ],
  { query: '?raw', import: 'default', eager: true }
)

let mounted = false

/** Serves the bundled templates from memory at `feature.agents.builtin`, where the desktop keeps them. */
export async function mountBuiltinAgentTemplates(): Promise<void> {
  if (mounted) return
  const root = application.getPath('feature.agents.builtin')
  vfs.mount(root, await resolveMountConfig({ backend: InMemory }))
  for (const [file, content] of Object.entries(templates)) {
    const target = path.join(root, file.slice(file.indexOf('builtin-agents/') + 'builtin-agents/'.length))
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  mounted = true
}
