/**
 * Generate Cherry Assistant's package-owned runtime artifacts. Product facts
 * come from current V2 source registries; stable prompts are copied from their
 * source templates.
 *
 * Run: pnpm build:builtin-knowledge
 * Verify in CI: pnpm build:builtin-knowledge:check
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { serializeProductManifest } from './generators/manifest'

const ROOT_DIR = path.resolve(__dirname, '..', '..')
const ASSISTANT_DIR = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant')
const SUPPORT_DIR = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-support')

interface GeneratedOutput {
  path: string
  content: string
}

function serializeAgentTemplate(agentDir: string): string {
  const templatePath = path.join(agentDir, 'agent-template.json')
  const parsed = JSON.parse(fs.readFileSync(templatePath, 'utf-8')) as Record<string, unknown>
  const agent = Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.startsWith('_')))
  return `${JSON.stringify(agent, null, 2)}\n`
}

const outputs: GeneratedOutput[] = [
  {
    path: path.join(ASSISTANT_DIR, 'product-manifest.json'),
    content: serializeProductManifest()
  },
  {
    path: path.join(ASSISTANT_DIR, '.claude/skills/cherry-assistant-guide/SKILL.md'),
    content: fs.readFileSync(
      path.join(ASSISTANT_DIR, '.claude/skills/cherry-assistant-guide/skill-zh-cn-template.md'),
      'utf-8'
    )
  },
  {
    path: path.join(ASSISTANT_DIR, 'agent.json'),
    content: serializeAgentTemplate(ASSISTANT_DIR)
  },
  {
    path: path.join(SUPPORT_DIR, 'agent.json'),
    content: serializeAgentTemplate(SUPPORT_DIR)
  }
]

const isCheck = process.argv.includes('--check')

if (isCheck) {
  let valid = true
  for (const output of outputs) {
    const relativeOutput = path.relative(ROOT_DIR, output.path)
    if (!fs.existsSync(output.path)) {
      console.error(`build:builtin-knowledge:check failed - ${relativeOutput} does not exist`)
      valid = false
    } else if (fs.readFileSync(output.path, 'utf-8') !== output.content) {
      console.error(`build:builtin-knowledge:check failed - ${relativeOutput} is out of date`)
      valid = false
    }
  }
  if (!valid) {
    process.exit(1)
  }
  console.log('build:builtin-knowledge:check passed')
} else {
  for (const output of outputs) {
    fs.writeFileSync(output.path, output.content, 'utf-8')
    console.log(`[builtin-knowledge] wrote ${path.relative(ROOT_DIR, output.path)} (${output.content.length} chars)`)
  }
}
