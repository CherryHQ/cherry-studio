import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import fs from 'fs'
import path from 'path'

import { readLocalOmlxConfig } from './config'

const logger = loggerService.withContext('LocalOmlxService')

const SAFE_EXTS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.html', '.css', '.js', '.ts'])
const BLOCKED_PARTS = new Set(['.git', 'node_modules', 'dist', 'build', 'venv', '__pycache__', '.env'])

type LocalOmlxRunOptions = {
  agentId: string
  userMessage: string
  model?: string
  apiUrl?: string
  apiKey?: string
  maxTokens?: number
  temperature?: number
}

function isSafePath(filePath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir)
  const resolvedFile = path.resolve(filePath)

  if (!resolvedFile.startsWith(resolvedBase)) return false
  if (resolvedFile.split(path.sep).some((part) => BLOCKED_PARTS.has(part))) return false
  if (!SAFE_EXTS.has(path.extname(resolvedFile).toLowerCase())) return false

  return true
}

function readTextSafe(filePath: string, baseDir: string, maxChars = 16000): string {
  if (!isSafePath(filePath, baseDir)) return ''
  if (!fs.existsSync(filePath)) return ''
  if (!fs.statSync(filePath).isFile()) return ''

  const text = fs.readFileSync(filePath, 'utf8')
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[TRUNCATED]` : text
}

function getAgentDir(agentId: string): string {
  const agentsRoot = path.join(getDataPath(), 'Agents')
  const exactDir = path.join(agentsRoot, agentId)

  if (fs.existsSync(exactDir)) {
    return exactDir
  }

  const shortId = agentId.split('_').pop()
  if (shortId) {
    const shortDir = path.join(agentsRoot, shortId)
    if (fs.existsSync(shortDir)) {
      return shortDir
    }
  }

  return exactDir
}

function buildPrompt(agentId: string, userMessage: string): string {
  const agentDir = getAgentDir(agentId)

  const userMd = readTextSafe(path.join(agentDir, 'USER.md'), agentDir, 4000)
  const soulMd = readTextSafe(path.join(agentDir, 'SOUL.md'), agentDir, 4000)

  const files = fs.existsSync(agentDir)
    ? fs
        .readdirSync(agentDir)
        .filter((name) => name.toLowerCase().includes('knowledge') && SAFE_EXTS.has(path.extname(name).toLowerCase()))
    : []

  const knowledge = files
    .map((name) => {
      const content = readTextSafe(path.join(agentDir, name), agentDir, 16000)
      return content ? `\n# FILE: ${name}\n${content}` : ''
    })
    .filter(Boolean)
    .join('\n')

  return `你是本地 oMLX Agent，負責系統設計、架構規劃、ComfyUI Web UI 設計與工程任務拆解。

重要規則：
1. 使用繁體中文。
2. 不呼叫 Claude Code。
3. 不使用 Anthropic / Claude tools。
4. 不使用 Cherry Studio Skills。
5. 不修改任何檔案。
6. 回答要結構化、精簡、可執行。
7. 如果資訊不足，請明確列出缺少的資料。

--- USER.md ---
${userMd}

--- SOUL.md ---
${soulMd}

--- Knowledge Base ---
${knowledge}

--- 使用者問題 ---
${userMessage}
`
}

export async function runLocalOmlxAgent(options: LocalOmlxRunOptions): Promise<string> {
  const config = readLocalOmlxConfig()
  const apiUrl = options.apiUrl ?? config.chatUrl
  const apiKey = options.apiKey ?? config.apiKey
  const rawModel = process.env.OMLX_MODEL ?? options.model ?? 'Qwen3.6-27B-UD-MLX-4bit'
  const model = rawModel.includes(':') ? rawModel.split(':').slice(1).join(':') : rawModel

  if (!apiKey) {
    throw new Error(`Local oMLX API key not found. Set OMLX_API_KEY or check ~/.omlx/settings.json`)
  }

  const prompt = buildPrompt(options.agentId, options.userMessage)

  logger.info('Running Local oMLX agent', {
    agentId: options.agentId,
    model,
    apiUrl,
    configSource: config.source,
    promptChars: prompt.length,
    claudeCodeInvoked: false
  })

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是本地 oMLX Agent，專注於系統設計、架構規劃、ComfyUI Web Design 與工程任務拆解。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: options.maxTokens ?? 1200,
      temperature: options.temperature ?? 0.2
    })
  })

  const data = await response.json()

  if (!response.ok || data.error) {
    throw new Error(`Local oMLX Agent error: ${JSON.stringify(data.error ?? data)}`)
  }

  const content = data?.choices?.[0]?.message?.content
  if (!content) {
    throw new Error(`Local oMLX Agent returned empty response: ${JSON.stringify(data)}`)
  }

  return content
}
