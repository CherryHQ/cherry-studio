#!/usr/bin/env tsx

/**
 * Populate reasoning metadata for models in models.json
 *
 * Extracts reasoning configuration from the renderer's hardcoded logic
 * (src/renderer/src/config/models/reasoning.ts) and applies it to
 * catalog models that have the REASONING capability but lack reasoning config.
 *
 * Usage: npx tsx packages/provider-catalog/scripts/populate-reasoning-data.ts [--dry-run]
 */

import * as fs from 'fs'
import * as path from 'path'

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface ReasoningConfig {
  type: string
  params?: Record<string, unknown>
  thinkingTokenLimits?: { min: number; max: number }
  supportedEfforts?: string[]
  interleaved?: boolean
}

interface ModelEntry {
  id: string
  capabilities?: string[]
  reasoning?: ReasoningConfig
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

// ═══════════════════════════════════════════════════════════════════════════════
// Data extracted from renderer hardcoded logic
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Thinking token limits extracted from THINKING_TOKEN_MAP
 * in src/renderer/src/config/models/reasoning.ts
 *
 * Pattern → { min, max }
 */
const THINKING_TOKEN_LIMITS: Array<{ pattern: RegExp; limits: { min: number; max: number } }> = [
  // Gemini models
  { pattern: /^gemini-.*flash-lite/i, limits: { min: 512, max: 24576 } },
  { pattern: /^gemini-.*flash/i, limits: { min: 0, max: 24576 } },
  { pattern: /^gemini-.*pro/i, limits: { min: 128, max: 32768 } },

  // Qwen models (specific before general)
  { pattern: /^qwen3-235b-a22b-thinking/i, limits: { min: 0, max: 81920 } },
  { pattern: /^qwen3-30b-a3b-thinking/i, limits: { min: 0, max: 81920 } },
  { pattern: /^qwen3-vl-235b-a22b-thinking/i, limits: { min: 0, max: 81920 } },
  { pattern: /^qwen3-vl-30b-a3b-thinking/i, limits: { min: 0, max: 81920 } },
  { pattern: /^qwen-plus-2025-07-14$/i, limits: { min: 0, max: 38912 } },
  { pattern: /^qwen-plus-2025-04-28$/i, limits: { min: 0, max: 38912 } },
  { pattern: /^qwen3-1-7b$/i, limits: { min: 0, max: 30720 } },
  { pattern: /^qwen3-0-6b$/i, limits: { min: 0, max: 30720 } },
  { pattern: /^qwen-plus/i, limits: { min: 0, max: 81920 } },
  { pattern: /^qwen-turbo/i, limits: { min: 0, max: 38912 } },
  { pattern: /^qwen-flash/i, limits: { min: 0, max: 81920 } },
  { pattern: /^qwen3-(?!max)/i, limits: { min: 1024, max: 38912 } },

  // Claude models (AWS Bedrock prefix, GCP @ separator, -v1:0 suffix)
  { pattern: /(?:anthropic\.)?claude-3-7.*sonnet/i, limits: { min: 1024, max: 64000 } },
  { pattern: /(?:anthropic\.)?claude-(?:haiku|sonnet|opus)-4-5/i, limits: { min: 1024, max: 64000 } },
  { pattern: /(?:anthropic\.)?claude-opus-4-1/i, limits: { min: 1024, max: 32000 } },
  { pattern: /(?:anthropic\.)?claude-sonnet-4(?:-0)?(?:[@-]|$)/i, limits: { min: 1024, max: 64000 } },
  { pattern: /(?:anthropic\.)?claude-opus-4(?:-0)?(?:[@-]|$)/i, limits: { min: 1024, max: 32000 } },

  // Baichuan models
  { pattern: /^baichuan-m[23]$/i, limits: { min: 0, max: 30000 } }
]

/**
 * Model ID patterns → reasoning config
 *
 * Maps model IDs to their reasoning type and supported efforts.
 * Extracted from the renderer's detection functions and effort tables.
 *
 * Order matters: more specific patterns should come first.
 */
const REASONING_RULES: Array<{
  /** Pattern to match model ID (case-insensitive) */
  pattern: RegExp
  /** Reasoning type for the catalog */
  type: string
  /** Supported effort levels */
  supportedEfforts: string[]
  /** If true, this is a fixed reasoning model (no control) - skip adding reasoning field */
  fixedReasoning?: boolean
}> = [
  // ── OpenAI models ──────────────────────────────────────────────────────────

  // Deep Research models
  { pattern: /^o3-deep-research/i, type: 'openai-chat', supportedEfforts: ['medium'] },
  { pattern: /^o4-mini-deep-research/i, type: 'openai-chat', supportedEfforts: ['medium'] },

  // GPT-5.2 Pro
  { pattern: /^gpt-5-2-pro/i, type: 'openai-chat', supportedEfforts: ['medium', 'high', 'xhigh'] },
  // GPT-5.2
  {
    pattern: /^gpt-5-2(?:-codex)?/i,
    type: 'openai-chat',
    supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh']
  },
  // GPT-5.1 Codex Max
  { pattern: /^gpt-5-1-codex-max/i, type: 'openai-chat', supportedEfforts: ['none', 'medium', 'high', 'xhigh'] },
  // GPT-5.1 Codex
  { pattern: /^gpt-5-1-codex/i, type: 'openai-chat', supportedEfforts: ['none', 'medium', 'high'] },
  // GPT-5.1
  { pattern: /^gpt-5-1/i, type: 'openai-chat', supportedEfforts: ['none', 'low', 'medium', 'high'] },
  // GPT-5 Pro
  { pattern: /^gpt-5-pro/i, type: 'openai-chat', supportedEfforts: ['high'] },
  // GPT-5 Codex
  { pattern: /^gpt-5-codex/i, type: 'openai-chat', supportedEfforts: ['low', 'medium', 'high'] },
  // GPT-5
  { pattern: /^gpt-5(?!-[0-9])/i, type: 'openai-chat', supportedEfforts: ['minimal', 'low', 'medium', 'high'] },

  // o-series
  { pattern: /^o3-pro/i, type: 'openai-chat', supportedEfforts: ['low', 'medium', 'high'] },
  { pattern: /^o3-mini/i, type: 'openai-chat', supportedEfforts: ['low', 'medium', 'high'] },
  { pattern: /^o3(?!-)/i, type: 'openai-chat', supportedEfforts: ['low', 'medium', 'high'] },
  { pattern: /^o4-mini/i, type: 'openai-chat', supportedEfforts: ['low', 'medium', 'high'] },
  { pattern: /^o1-pro/i, type: 'openai-chat', supportedEfforts: ['low', 'medium', 'high'] },
  { pattern: /^o1(?:-2024)?/i, type: 'openai-chat', supportedEfforts: ['low', 'medium', 'high'] },

  // o1-preview and o1-mini are fixed reasoning (no effort control)
  { pattern: /^o1-preview/i, type: '', supportedEfforts: [], fixedReasoning: true },
  { pattern: /^o1-mini/i, type: '', supportedEfforts: [], fixedReasoning: true },

  // ── Claude models ──────────────────────────────────────────────────────────
  {
    pattern: /(?:anthropic\.)?claude-3-7.*sonnet/i,
    type: 'anthropic',
    supportedEfforts: ['none', 'low', 'medium', 'high']
  },
  {
    pattern: /(?:anthropic\.)?claude-sonnet-4/i,
    type: 'anthropic',
    supportedEfforts: ['none', 'low', 'medium', 'high']
  },
  {
    pattern: /(?:anthropic\.)?claude-opus-4/i,
    type: 'anthropic',
    supportedEfforts: ['none', 'low', 'medium', 'high']
  },
  {
    pattern: /(?:anthropic\.)?claude-haiku-4/i,
    type: 'anthropic',
    supportedEfforts: ['none', 'low', 'medium', 'high']
  },

  // ── Gemini models ──────────────────────────────────────────────────────────
  { pattern: /^gemini-3-flash/i, type: 'gemini', supportedEfforts: ['minimal', 'low', 'medium', 'high'] },
  { pattern: /^gemini-3-pro(?!-image)/i, type: 'gemini', supportedEfforts: ['low', 'high'] },
  { pattern: /^gemini-2-5-flash-lite/i, type: 'gemini', supportedEfforts: ['none', 'low', 'medium', 'high', 'auto'] },
  { pattern: /^gemini-2-5-flash/i, type: 'gemini', supportedEfforts: ['none', 'low', 'medium', 'high', 'auto'] },
  { pattern: /^gemini-2-5-pro/i, type: 'gemini', supportedEfforts: ['low', 'medium', 'high', 'auto'] },

  // ── Grok models ────────────────────────────────────────────────────────────
  { pattern: /^grok-4-fast(?!-non)/i, type: 'openai-chat', supportedEfforts: ['auto'] },
  { pattern: /^grok-4-1-fast(?!-non)/i, type: 'openai-chat', supportedEfforts: ['auto'] },
  { pattern: /^grok-3-mini/i, type: 'openai-chat', supportedEfforts: ['low', 'high'] },
  // grok-4 (without -fast) is fixed reasoning
  { pattern: /^grok-4(?!-fast|-1)/i, type: 'openai-chat', supportedEfforts: [], fixedReasoning: true },

  // ── Qwen models (controllable) ─────────────────────────────────────────────
  // Qwen3 thinking variants are always-think (not controllable but still have token limits)
  { pattern: /^qwen3.*thinking/i, type: 'qwen', supportedEfforts: ['low', 'medium', 'high'] },
  // Qwen3 controllable (excluding instruct, max, coder)
  {
    pattern: /^qwen3-(?!max|.*instruct|.*coder|.*thinking)/i,
    type: 'qwen',
    supportedEfforts: ['none', 'low', 'medium', 'high']
  },
  { pattern: /^qwen-plus/i, type: 'qwen', supportedEfforts: ['none', 'low', 'medium', 'high'] },
  { pattern: /^qwen-turbo/i, type: 'qwen', supportedEfforts: ['none', 'low', 'medium', 'high'] },
  { pattern: /^qwen-flash/i, type: 'qwen', supportedEfforts: ['none', 'low', 'medium', 'high'] },

  // ── Doubao models ──────────────────────────────────────────────────────────
  { pattern: /^doubao-seed-1-8/i, type: 'doubao', supportedEfforts: ['minimal', 'low', 'medium', 'high'] },
  {
    pattern: /^doubao-seed-1-6-(?:lite-)?251015/i,
    type: 'doubao',
    supportedEfforts: ['minimal', 'low', 'medium', 'high']
  },
  { pattern: /^doubao-1-5-thinking-pro-m/i, type: 'doubao', supportedEfforts: ['none', 'auto', 'high'] },
  {
    pattern: /^doubao-seed-1-6(?!-thinking|-flash|-lite|-vision|-25)/i,
    type: 'doubao',
    supportedEfforts: ['none', 'auto', 'high']
  },
  { pattern: /^doubao-1-5-thinking/i, type: 'doubao', supportedEfforts: ['none', 'high'] },
  { pattern: /^doubao-seed-code/i, type: 'doubao', supportedEfforts: ['none', 'high'] },

  // ── Hunyuan models ─────────────────────────────────────────────────────────
  { pattern: /^hunyuan-a13b/i, type: 'qwen', supportedEfforts: ['none', 'auto'] },

  // ── ZhiPu models ──────────────────────────────────────────────────────────
  { pattern: /^glm-4-[567]/i, type: 'doubao', supportedEfforts: ['none', 'auto'] },

  // ── MiMo models ────────────────────────────────────────────────────────────
  { pattern: /^mimo-v2-flash/i, type: 'doubao', supportedEfforts: ['none', 'auto'] },

  // ── Perplexity models ──────────────────────────────────────────────────────
  { pattern: /^sonar-deep-research/i, type: 'openai-chat', supportedEfforts: ['low', 'medium', 'high'] },

  // ── DeepSeek hybrid inference ──────────────────────────────────────────────
  { pattern: /^deepseek-v3/i, type: 'self-hosted', supportedEfforts: ['none', 'auto'] },
  { pattern: /^deepseek-chat/i, type: 'self-hosted', supportedEfforts: ['none', 'auto'] },

  // ── MiniMax models ───────────────────────────────────────────────────────
  { pattern: /^minimax-m2/i, type: 'openai-chat', supportedEfforts: [] },

  // ── Kimi models ─────────────────────────────────────────────────────────
  { pattern: /^kimi-k2-thinking$/i, type: 'openai-chat', supportedEfforts: [] },

  // ── Fixed reasoning models (no reasoning field, only REASONING capability) ──
  { pattern: /^deepseek-r1/i, type: '', supportedEfforts: [], fixedReasoning: true },
  { pattern: /^qwq/i, type: '', supportedEfforts: [], fixedReasoning: true },
  { pattern: /^qvq/i, type: '', supportedEfforts: [], fixedReasoning: true },
  { pattern: /^hunyuan-t1/i, type: '', supportedEfforts: [], fixedReasoning: true }
]

/**
 * Models that support interleaved thinking (reasoning content sent back to model).
 * Extracted from INTERLEAVED_THINKING_MODEL_REGEX in renderer config.
 */
const INTERLEAVED_THINKING_REGEX =
  /minimax-m2(.(\d+))?(?:-[\w-]+)?|mimo-v2-flash|glm-4.(\d+)(?:-[\w-]+)?|kimi-k2-thinking$/i

// ═══════════════════════════════════════════════════════════════════════════════
// Main Logic
// ═══════════════════════════════════════════════════════════════════════════════

function findThinkingTokenLimits(modelId: string): { min: number; max: number } | undefined {
  for (const { pattern, limits } of THINKING_TOKEN_LIMITS) {
    if (pattern.test(modelId)) {
      return limits
    }
  }
  return undefined
}

function findReasoningRule(modelId: string): (typeof REASONING_RULES)[0] | undefined {
  for (const rule of REASONING_RULES) {
    if (rule.pattern.test(modelId)) {
      return rule
    }
  }
  return undefined
}

function buildReasoningConfig(modelId: string): ReasoningConfig | null {
  const rule = findReasoningRule(modelId)
  if (!rule) {
    return null
  }

  // Fixed reasoning models: no reasoning field
  if (rule.fixedReasoning) {
    return null
  }

  const config: ReasoningConfig = {
    type: rule.type,
    supportedEfforts: rule.supportedEfforts
  }

  // Add thinking token limits if available
  const limits = findThinkingTokenLimits(modelId)
  if (limits) {
    config.thinkingTokenLimits = limits
  }

  // Add interleaved flag if model supports it
  if (INTERLEAVED_THINKING_REGEX.test(modelId)) {
    config.interleaved = true
  }

  return config
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run')

  const modelsPath = path.resolve(__dirname, '../data/models.json')
  const raw = fs.readFileSync(modelsPath, 'utf-8')
  const data = JSON.parse(raw) as { version: string; models: ModelEntry[] }

  let populated = 0
  let capAdded = 0
  let interleavedAdded = 0
  let skippedAlreadyHas = 0
  let skippedNoRule = 0
  let skippedFixed = 0
  let skippedNoReasoning = 0

  for (const model of data.models) {
    const hasReasoningCap = model.capabilities?.includes('reasoning')

    // Check if model matches a reasoning rule even without REASONING capability
    if (!hasReasoningCap) {
      const rule = findReasoningRule(model.id)
      if (rule) {
        // Auto-add REASONING capability when a rule matches
        if (!model.capabilities) {
          model.capabilities = ['reasoning']
        } else {
          model.capabilities.push('reasoning')
        }
        capAdded++
        if (isDryRun) {
          console.log(`  [cap-added] ${model.id} → REASONING capability added`)
        }
      } else {
        skippedNoReasoning++
        continue
      }
    }

    // Skip models that already have reasoning data, but check if we need to add interleaved
    if (model.reasoning) {
      const metadata = model.metadata as Record<string, unknown> | undefined
      const hasInterleavedMetadata = metadata?.interleavedThinking === true
      if (!model.reasoning.interleaved && (INTERLEAVED_THINKING_REGEX.test(model.id) || hasInterleavedMetadata)) {
        model.reasoning.interleaved = true
        interleavedAdded++
        if (isDryRun) {
          console.log(`  [interleaved] ${model.id} → added interleaved flag`)
        }
      }
      skippedAlreadyHas++
      continue
    }

    const config = buildReasoningConfig(model.id)
    if (config === null) {
      const rule = findReasoningRule(model.id)
      if (rule?.fixedReasoning) {
        skippedFixed++
      } else {
        skippedNoRule++
        if (isDryRun) {
          console.log(`  [no-rule] ${model.id}`)
        }
      }
      continue
    }

    model.reasoning = config
    populated++
    if (isDryRun) {
      console.log(
        `  [populate] ${model.id} → type=${config.type}, efforts=[${config.supportedEfforts?.join(',')}], limits=${config.thinkingTokenLimits ? `${config.thinkingTokenLimits.min}-${config.thinkingTokenLimits.max}` : 'none'}`
      )
    }
  }

  console.log('\n=== Summary ===')
  console.log(`Total models: ${data.models.length}`)
  console.log(`With REASONING capability: ${data.models.filter((m) => m.capabilities?.includes('reasoning')).length}`)
  console.log(`Populated with reasoning config: ${populated}`)
  console.log(`REASONING capability auto-added: ${capAdded}`)
  console.log(`Interleaved flag added to existing: ${interleavedAdded}`)
  console.log(`Skipped (already has reasoning): ${skippedAlreadyHas}`)
  console.log(`Skipped (fixed reasoning, no control): ${skippedFixed}`)
  console.log(`Skipped (no matching rule): ${skippedNoRule}`)
  console.log(`Skipped (no REASONING capability): ${skippedNoReasoning}`)

  if (!isDryRun && (populated > 0 || interleavedAdded > 0)) {
    fs.writeFileSync(modelsPath, JSON.stringify(data, null, 2) + '\n')
    console.log(`\nWritten to ${modelsPath}`)
  } else if (isDryRun) {
    console.log('\n[dry-run] No changes written.')
  } else {
    console.log('\nNo changes needed.')
  }
}

main().catch(console.error)
