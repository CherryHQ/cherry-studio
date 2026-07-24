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
import { serializeBundledPluginsManifest } from './generators/plugins'

const ROOT_DIR = path.resolve(__dirname, '..', '..')
const AGENT_DIR = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant')

interface GeneratedOutput {
  path: string
  content: string
}

function serializeAgentTemplate(): string {
  const templatePath = path.join(AGENT_DIR, 'agent.template.json')
  const parsed = JSON.parse(fs.readFileSync(templatePath, 'utf-8')) as Record<string, unknown>
  const agent = Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.startsWith('_')))
  return `${JSON.stringify(agent, null, 2)}\n`
}

const baseOutputs: GeneratedOutput[] = [
  {
    path: path.join(AGENT_DIR, 'product-manifest.json'),
    content: serializeProductManifest()
  },
  {
    path: path.join(AGENT_DIR, '.claude/skills/cherry-assistant-guide/SKILL.md'),
    content: fs.readFileSync(
      path.join(AGENT_DIR, '.claude/skills/cherry-assistant-guide/SKILL.zh-CN.template.md'),
      'utf-8'
    )
  },
  {
    path: path.join(AGENT_DIR, 'agent.json'),
    content: serializeAgentTemplate()
  }
]

function pluginManifestOutput(): GeneratedOutput {
  return {
    path: path.join(AGENT_DIR, '.claude/plugins.json'),
    content: serializeBundledPluginsManifest()
  }
}

const isCheck = process.argv.includes('--check')

if (isCheck) {
  let valid = true
  for (const output of [...baseOutputs, pluginManifestOutput()]) {
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
  for (const output of baseOutputs) {
    fs.writeFileSync(output.path, output.content, 'utf-8')
    console.log(`[builtin-knowledge] wrote ${path.relative(ROOT_DIR, output.path)} (${output.content.length} chars)`)
  }
  const pluginOutput = pluginManifestOutput()
  fs.writeFileSync(pluginOutput.path, pluginOutput.content, 'utf-8')
  console.log(
    `[builtin-knowledge] wrote ${path.relative(ROOT_DIR, pluginOutput.path)} (${pluginOutput.content.length} chars)`
  )
}
