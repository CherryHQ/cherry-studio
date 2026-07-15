/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Compiled from `Creator.reasoningMembership` declarations (creators/*.ts)
 * by scripts/generate-catalog.ts — edit the creator and run `pnpm generate`.
 */

export const REASONING_MEMBERSHIP_PATTERNS: readonly string[] = [
  // alibaba
  '^qwen3.*thinking',
  'qwq|qvq',
  '^(?!.*(?:coder|asr|tts|reranker|embedding|instruct|thinking))qwen3[.-][5-9](?!\\d)',
  '^(?!.*(?:coder|asr|tts|reranker|embedding|instruct|thinking))(?:qwen3-max(?!-2025-09-23)|qwen-max-latest)(?:-|$)',
  '^(?!.*(?:coder|asr|tts|reranker|embedding|instruct|thinking))qwen(?:3[.-][5-9])?-(?:plus|flash|turbo)(?:-|$)',
  '^(?!.*(?:coder|asr|tts|reranker|embedding|instruct|thinking))qwen3-\\d',
  // anthropic
  'claude-3-7-sonnet|claude-3\\.7-sonnet',
  'claude-(?:sonnet|opus|haiku)-4',
  '^(?:anthropic\\.)?claude-(?:(?:opus|sonnet|haiku)-[5-9](?!\\d)|(?:opus|sonnet|haiku)-latest|fable)',
  // baichuan
  '^baichuan-m[23]$',
  // bailing
  'ring-(?:1t|mini|flash)',
  // bytedance
  'doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-][68](?:-flash)?(?!-thinking(?:-|$))|seed-code(?:-preview)?(?:-\\d+)?|seed-2[.-]\\d(?:-[\\w-]+)?)(?:-[\\w-]+)*',
  'seed-oss',
  // deepseek
  '(\\w+-)?deepseek-v3(?:\\.\\d|-\\d)(?:(\\.|-)(?!speciale$)\\w+)?$',
  'deepseek-chat',
  'deepseek-v(?:[4-9]\\d*|[1-9]\\d{1,})(?:\\.\\d+)?(?:-[\\w]+)*(?=$|[:/])',
  'deepseek-v3\\.2-speciale',
  // google
  '^gemini.*thinking',
  'gemini-3(?:\\.\\d+)?-pro-image',
  '^(?!.*(?:image|tts)).*gemini-(?:2\\.5.*(?:-latest)?|3(?:\\.\\d+)?-(?:flash|pro)(?:-preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\\w-]+)*$',
  'gemma-?4',
  // minimax
  'minimax-m[123]',
  // mistral
  'magistral',
  'mistral-small-2603',
  // moonshot
  '^kimi-k2-thinking(?:-turbo)?$|^kimi-k(?:2[.-][5-9]\\d*|[3-9]\\d*(?:[.-]\\d+)?)(?:-[\\w-]+)?$',
  // openai
  '^o\\d+(?:-[\\w-]+)?$',
  '^(?!.*o1-(?:preview|mini)).*o1',
  '^(?!.*o3-mini).*o3',
  '^o3',
  '^o4',
  'gpt-oss',
  '^(?!.*chat).*gpt-5',
  // perplexity
  'sonar-deep-research',
  // stepfun
  'step-3',
  'step-r1-v-mini',
  // tencent
  'hunyuan-t1',
  'hunyuan-a13b',
  // xai
  '\\bgrok-(?:3-mini|4|4-fast)(?:-[\\w-]+)?\\b',
  'grok-build',
  // xiaomi
  'mimo-v2[.-]5(?:-pro)?(?!-)|mimo-v2-(?:flash|pro|omni)',
  // zhipu
  'glm-zero-preview',
  'glm-?5|glm-4[.-][567]|glm-z1'
]
