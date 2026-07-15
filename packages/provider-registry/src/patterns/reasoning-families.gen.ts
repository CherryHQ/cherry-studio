/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Compiled from `Creator.reasoningFamilies` declarations (creators/*.ts)
 * by scripts/generate-catalog.ts — edit the creator and run `pnpm generate`.
 * Array order is match priority (CREATORS order × declaration order).
 */
import type { ReasoningFamilyRule } from '../schemas/model'

export const REASONING_FAMILY_RULES: readonly ReasoningFamilyRule[] = [
  // alibaba
  { pattern: '^qwen3(?:-vl)?-.*thinking', toggle: false },
  { pattern: '^qwq|^qvq', toggle: false },
  { pattern: '^qwen', toggle: true },
  { pattern: 'qwen3-235b-a22b-thinking-2507$', budget: { min: 0, max: 81920 } },
  { pattern: 'qwen3-30b-a3b-thinking-2507$', budget: { min: 0, max: 81920 } },
  { pattern: 'qwen3-vl-235b-a22b-thinking$', budget: { min: 0, max: 81920 } },
  { pattern: 'qwen3-vl-30b-a3b-thinking$', budget: { min: 0, max: 81920 } },
  { pattern: 'qwen-plus-2025-07-14$', budget: { min: 0, max: 38912 } },
  { pattern: 'qwen-plus-2025-04-28$', budget: { min: 0, max: 38912 } },
  { pattern: 'qwen3-1[.-]7b$', budget: { min: 0, max: 30720 } },
  { pattern: 'qwen3-0[.-]6b$', budget: { min: 0, max: 30720 } },
  { pattern: 'qwen-plus.*$', budget: { min: 0, max: 81920 } },
  { pattern: 'qwen-turbo.*$', budget: { min: 0, max: 38912 } },
  { pattern: 'qwen-flash.*$', budget: { min: 0, max: 81920 } },
  { pattern: 'qwen3-max(-.*)?$', budget: { min: 0, max: 81920 } },
  { pattern: 'qwen-max-latest$', budget: { min: 0, max: 81920 } },
  { pattern: '^qwen3[.-][5-9](?!\\d)', budget: { min: 0, max: 81920 } },
  { pattern: 'qwen3-(?!max).*$', budget: { min: 1024, max: 38912 } },
  // anthropic
  {
    pattern:
      '^(?:anthropic\\.)?claude-(?:(?:opus|sonnet|haiku)-(?:4[.-][6-9]|[5-9])(?!\\d)|(?:opus|sonnet|haiku)-latest|fable)',
    effort: ['low', 'medium', 'high', 'max'],
    toggle: true
  },
  { pattern: '^(?:anthropic\\.)?claude', toggle: true },
  { pattern: '(?:anthropic\\.)?claude-opus-4[.-]7(?:[@\\-:][\\w\\-:]+)?$', budget: { min: 1024, max: 128000 } },
  { pattern: '(?:anthropic\\.)?claude-opus-4[.-]6(?:[@\\-:][\\w\\-:]+)?$', budget: { min: 1024, max: 128000 } },
  { pattern: '(?:anthropic\\.)?claude-(:?sonnet|haiku)-4[.-]6.*(?:-v\\d+:\\d+)?$', budget: { min: 1024, max: 64000 } },
  {
    pattern: '(?:anthropic\\.)?claude-(:?haiku|sonnet|opus)-4[.-]5.*(?:-v\\d+:\\d+)?$',
    budget: { min: 1024, max: 64000 }
  },
  { pattern: '(?:anthropic\\.)?claude-opus-4[.-]1.*(?:-v\\d+:\\d+)?$', budget: { min: 1024, max: 32000 } },
  {
    pattern: '(?:anthropic\\.)?claude-sonnet-4(?:[.-]0)?(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$',
    budget: { min: 1024, max: 64000 }
  },
  {
    pattern: '(?:anthropic\\.)?claude-opus-4(?:[.-]0)?(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$',
    budget: { min: 1024, max: 32000 }
  },
  { pattern: '(?:anthropic\\.)?claude-3[.-]7.*sonnet.*(?:-v\\d+:\\d+)?$', budget: { min: 1024, max: 64000 } },
  // baichuan
  { pattern: 'baichuan-m2$', budget: { min: 0, max: 30000 } },
  { pattern: 'baichuan-m3$', budget: { min: 0, max: 30000 } },
  // bytedance
  {
    pattern: 'doubao-seed-1-6-(?:lite-)?251015|doubao-seed-2[.-]\\d|doubao-seed-1[.-]8',
    effort: ['minimal', 'low', 'medium', 'high']
  },
  {
    pattern: 'doubao-(1-5-thinking-pro-m|seed-1[.-]6)(?!-(?:flash|thinking)(?:-|$))(?:-lite)?(?!-251015)(?:-\\d+)?$',
    effort: ['none', 'auto', 'high']
  },
  {
    pattern:
      'doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-][68](?:-flash)?(?!-thinking(?:-|$))|seed-code(?:-preview)?(?:-\\d+)?|seed-2[.-]\\d(?:-[\\w-]+)?)(?:-[\\w-]+)*',
    effort: ['none', 'high'],
    budget: { min: 0, max: 30720 }
  },
  // deepseek
  { pattern: '^deepseek-v(?:[4-9]\\d*|[1-9]\\d{1,})(?:\\.\\d+)?', effort: ['none', 'high', 'max'] },
  { pattern: 'deepseek-(?:chat|v3(?:\\.\\d|-\\d))', toggle: true },
  // google
  { pattern: '^gemma-?4', effort: ['minimal', 'high'] },
  {
    pattern: '^gemini-3(?:\\.\\d+)?-flash|^gemini-3\\.1-flash-lite|^gemini-flash-latest',
    effort: ['minimal', 'low', 'medium', 'high']
  },
  { pattern: '^gemini-3-pro', effort: ['low', 'high'] },
  { pattern: '^gemini-3\\.\\d+-pro|^gemini-pro-latest', effort: ['low', 'medium', 'high'] },
  { pattern: '^gemini-[\\d.]+.*flash', toggle: true },
  { pattern: 'gemini-2[.-]5-flash-lite.*$', budget: { min: 512, max: 24576 } },
  { pattern: 'gemini-flash-lite-latest$', budget: { min: 512, max: 24576 } },
  { pattern: 'gemini-flash-latest$', budget: { min: 0, max: 24576 } },
  { pattern: 'gemini-pro-latest$', budget: { min: 128, max: 32768 } },
  { pattern: 'gemini-.*-flash.*$', budget: { min: 0, max: 24576 } },
  { pattern: 'gemini-.*-pro.*$', budget: { min: 128, max: 32768 } },
  { pattern: 'gemma-?4[:-]?e[24]b', budget: { min: 1024, max: 8192 } },
  { pattern: 'gemma-?4[:-]?26b', budget: { min: 1024, max: 30720 } },
  { pattern: 'gemma-?4[:-]?31b', budget: { min: 1024, max: 30720 } },
  // mistral
  { pattern: '^mistral-small-2603', effort: ['none', 'high'] },
  // moonshot
  { pattern: '^kimi-k(?:2[.-][5-9]\\d*|[3-9]\\d*(?:[.-]\\d+)?)', toggle: true },
  { pattern: 'kimi-k(?:2[.-][5-9]\\d*|[3-9]\\d*(?:[.-]\\d+)?)', budget: { min: 0, max: 30720 } },
  // openai
  { pattern: '^(?:o\\d|gpt).*deep[-_]?research', effort: ['medium'] },
  { pattern: '^gpt-5[.-]1-codex-max', effort: ['medium', 'high', 'xhigh'] },
  { pattern: '^gpt-5[.-]1-codex', effort: ['medium', 'high'] },
  { pattern: '^gpt-5[.-]1(?!\\d)', effort: ['none', 'low', 'medium', 'high'] },
  { pattern: '^gpt-5-pro', effort: ['high'] },
  { pattern: '^gpt-5[.-]\\d+-pro', effort: ['medium', 'high', 'xhigh'] },
  { pattern: '^gpt-5-codex', effort: ['low', 'medium', 'high'] },
  { pattern: '^gpt-5[.-]\\d+-codex', effort: ['low', 'medium', 'high', 'xhigh'] },
  { pattern: '^gpt-5[.-]\\d+(?!.*chat)', effort: ['none', 'low', 'medium', 'high', 'xhigh'] },
  { pattern: '^gpt-5(?![.-]\\d)(?!.*chat)', effort: ['minimal', 'low', 'medium', 'high'] },
  { pattern: '^gpt-oss', effort: ['low', 'medium', 'high'] },
  { pattern: '^o1(?!-preview|-mini)|^o3|^o4', effort: ['low', 'medium', 'high'] },
  // perplexity
  { pattern: '^sonar-reasoning|^sonar-deep-research', effort: ['low', 'medium', 'high'] },
  // tencent
  { pattern: '^hunyuan-a13b', toggle: true },
  { pattern: 'hunyuan-a13b', budget: { min: 0, max: 30720 } },
  // xai
  { pattern: '^grok-4\\.3(?!.*non-reasoning)', effort: ['none', 'low', 'medium', 'high'] },
  { pattern: '^grok-3-mini', effort: ['low', 'high'] },
  // xiaomi
  { pattern: 'mimo-v2[.-]5(?:-pro)?(?!-)|mimo-v2-(?:flash|pro|omni)', toggle: true },
  { pattern: 'mimo-v2[.-]5(?:-pro)?(?!-)', budget: { min: 0, max: 30720 } },
  { pattern: 'mimo-v2-(?:flash|pro|omni)', budget: { min: 0, max: 30720 } },
  // zhipu
  { pattern: 'glm-?5|glm-4[.-][567]', toggle: true, budget: { min: 0, max: 30720 } }
]
