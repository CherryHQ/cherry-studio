/**
 * Generate Cherry Assistant's runtime knowledge artifacts from real source-of-truth
 * data (SystemProviderIds, i18n locale files) plus human-authored narrative
 * templates.
 *
 * The provider list, provider count, locale list, and locale count are all
 * drawn from real source files. Other sections (routes, hotkeys, paths,
 * diagnostics) remain in the template verbatim — they can be generator-fed
 * in later phases when their own source-of-truth is ready.
 *
 * Run: pnpm build:builtin-knowledge
 * Verify in CI: pnpm build:builtin-knowledge:check
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { generateLanguagesFragment } from './generators/languages'
import { generateProvidersFragment } from './generators/providers'
import { type Language, render } from './templating'

const ROOT_DIR = path.resolve(__dirname, '..', '..')
const AGENT_DIR = path.join(ROOT_DIR, 'resources/builtin-agents/cherry-assistant')
const SKILL_DIR = path.join(AGENT_DIR, '.claude/skills/cherry-assistant-guide')

type OutputKind = 'markdown' | 'json'

interface OutputSpec {
  lang: Language
  kind: OutputKind
  templatePath: string
  outputPath: string
}

const OUTPUTS: OutputSpec[] = [
  {
    lang: 'zh-CN',
    kind: 'markdown',
    templatePath: path.join(SKILL_DIR, 'SKILL.zh-CN.template.md'),
    outputPath: path.join(SKILL_DIR, 'SKILL.md')
  },
  {
    lang: 'zh-CN',
    kind: 'json',
    templatePath: path.join(AGENT_DIR, 'agent.template.json'),
    outputPath: path.join(AGENT_DIR, 'agent.json')
  }
]

function buildValues(lang: Language): Record<string, string> {
  const providers = generateProvidersFragment(lang)
  if (providers.unknown.length > 0) {
    console.warn(
      `[builtin-knowledge] warning: ${providers.unknown.length} provider id(s) in SystemProviderIds are not categorized in provider-categories.json: ${providers.unknown.join(', ')}. They will appear under "other" with the raw id as their display name.`
    )
  }
  const languages = generateLanguagesFragment(lang)
  return {
    providers_summary: providers.summary,
    providers_count: String(providers.count),
    languages_summary: languages.summary,
    languages_count: String(languages.count)
  }
}

function stripTemplateOnlyKeys(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (k.startsWith('_')) continue
    out[k] = v
  }
  return out
}

function generate(spec: OutputSpec): string {
  const template = fs.readFileSync(spec.templatePath, 'utf-8')
  const values = buildValues(spec.lang)
  const { output, unresolved } = render(template, values)
  if (unresolved.length > 0) {
    throw new Error(
      `Template ${path.relative(ROOT_DIR, spec.templatePath)} has unresolved placeholders: ${unresolved.join(', ')}. ` +
        `Either implement a generator for them or remove them from the template.`
    )
  }

  if (spec.kind === 'json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(output)
    } catch (err) {
      throw new Error(
        `Rendered ${path.relative(ROOT_DIR, spec.templatePath)} is not valid JSON: ${(err as Error).message}`
      )
    }
    const stripped = stripTemplateOnlyKeys(parsed)
    return `${JSON.stringify(stripped, null, 2)}\n`
  }

  return output
}

function check(spec: OutputSpec, content: string): boolean {
  if (!fs.existsSync(spec.outputPath)) {
    console.error(
      `build:builtin-knowledge:check failed — ${path.relative(ROOT_DIR, spec.outputPath)} does not exist (run pnpm build:builtin-knowledge)`
    )
    return false
  }
  const existing = fs.readFileSync(spec.outputPath, 'utf-8')
  if (existing !== content) {
    console.error(
      `build:builtin-knowledge:check failed — ${path.relative(ROOT_DIR, spec.outputPath)} is out of date (run pnpm build:builtin-knowledge)`
    )
    return false
  }
  return true
}

function write(spec: OutputSpec, content: string): void {
  fs.writeFileSync(spec.outputPath, content, 'utf-8')
  console.log(`[builtin-knowledge] wrote ${path.relative(ROOT_DIR, spec.outputPath)} (${content.length} chars)`)
}

const isCheck = process.argv.includes('--check')
let ok = true

for (const spec of OUTPUTS) {
  const content = generate(spec)
  if (isCheck) {
    if (!check(spec, content)) ok = false
  } else {
    write(spec, content)
  }
}

if (isCheck) {
  if (ok) {
    console.log('build:builtin-knowledge:check passed')
  } else {
    process.exit(1)
  }
}
