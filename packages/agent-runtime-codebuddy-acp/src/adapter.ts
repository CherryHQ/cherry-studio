import { acpConfigRecord, type AcpJsonModelProfile } from '@cherrystudio/agent-runtime-acp/profile'

import { codeBuddyCli } from './cli'

const owner = 'x-cherry-studio'

function modelEntries(doc: Record<string, unknown>): unknown[] {
  if (doc.models === undefined) return []
  if (!Array.isArray(doc.models)) throw new Error('CodeBuddy models must be an array')
  return doc.models
}

function findModel(entries: readonly unknown[], matches: (model: Record<string, unknown>) => boolean) {
  for (const entry of entries) {
    const model = acpConfigRecord(entry)
    if (model && matches(model)) return model
  }
}

export function clearCodeBuddyModels(doc: Record<string, unknown>) {
  return { ...doc, models: modelEntries(doc).filter((entry) => acpConfigRecord(entry)?.[owner] !== true) }
}

export function writeCodeBuddyModel(
  doc: Record<string, unknown>,
  input: {
    id: string
    name: string
    vendor: string
    apiKey: string
    baseUrl: string
    responses: boolean
    supportsImages: boolean
    supportsReasoning: boolean
    maxInputTokens?: number
    maxOutputTokens?: number
  }
) {
  const retained = clearCodeBuddyModels(doc)
  if (findModel(retained.models, (model) => model.id === input.id)) {
    throw new Error('CodeBuddy already has a custom model with this ID. Edit its CLI configuration first.')
  }
  retained.models.push({
    id: input.id,
    name: input.name,
    vendor: input.vendor,
    apiKey: input.apiKey,
    url: input.responses ? input.baseUrl : input.baseUrl.replace(/\/$/, '') + '/chat/completions',
    api: input.responses ? 'openai-responses' : 'openai-completions',
    supportsToolCall: true,
    supportsImages: input.supportsImages,
    supportsReasoning: input.supportsReasoning,
    ...(input.maxInputTokens ? { maxInputTokens: input.maxInputTokens } : {}),
    ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
    [owner]: true
  })
  return retained
}

export function readCodeBuddyConnection(doc: Record<string, unknown>, id: unknown) {
  const entry = findModel(modelEntries(doc), (model) => model.id === id)
  if (!entry) return
  return {
    apiKey: entry.apiKey,
    baseUrl: typeof entry.url === 'string' ? entry.url.replace(/\/chat\/completions\/?$/, '') : undefined,
    model: entry.id,
    path: entry.api === 'openai-responses' ? '/v1/responses' : '/v1/chat/completions'
  }
}

function activeModel(settings: Record<string, unknown>) {
  return typeof settings.model === 'string' && settings.model ? settings.model : undefined
}

const profile = {
  format: 'json',
  target: codeBuddyCli.modelConfig.target,
  relatedTarget: 'codebuddy-models',
  readModel: activeModel,
  writeModel: (_doc, model) => [[['model'], model]],
  launch(doc, env, _get, related) {
    const active = activeModel(doc)
    const entry = findModel(
      Array.isArray(related?.models) ? related.models : [],
      (model) => model[owner] === true && (!active || model.id === active)
    )
    if (typeof entry?.apiKey === 'string' && entry.apiKey) env.CODEBUDDY_API_KEY = entry.apiKey
    return active
  }
} satisfies AcpJsonModelProfile<'codebuddy-settings' | 'codebuddy-models'>

export const codeBuddyPreset = {
  id: codeBuddyCli.id,
  profile,
  automationName(name: string, input: unknown) {
    if (name !== 'DeferExecuteTool') return
    const toolName = acpConfigRecord(input)?.toolName
    return typeof toolName === 'string' ? toolName.trim() : undefined
  }
}

export const codeBuddyWebUi = {
  launch(port: number, password: string, model?: string) {
    return {
      url: `http://127.0.0.1:${port}/?password=${password}`,
      args: [
        '--serve',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--auth',
        'password',
        ...(model ? ['--model', model] : [])
      ],
      env: { CODEBUDDY_GATEWAY_PASSWORD: password }
    }
  },
  addresses(data: unknown) {
    const record = acpConfigRecord(data)
    const ports: unknown[] = Array.isArray(record?.ports) ? record.ports.slice(0, 4) : [record?.port]
    return ports.flatMap((port) =>
      typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
        ? [`http://127.0.0.1:${port}/`]
        : []
    )
  },
  matches(html: string) {
    return /<title>CodeBuddy\b/i.test(html)
  }
}
