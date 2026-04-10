export interface CompareBlockMetaV1 {
  v: 1
  blocks: Record<
    string,
    {
      /** 对照区内容（Markdown，纯文本存储） */
      content: string
    }
  >
}

export type CompareBlockMeta = CompareBlockMetaV1

export interface ExtractCompareMetaResult {
  cleanMarkdown: string
  meta: CompareBlockMeta | null
}

const META_TAG_NAME = 'cs-compare-meta'

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCompareBlockMetaV1(value: unknown): value is CompareBlockMetaV1 {
  if (!isRecord(value)) return false
  if (value.v !== 1) return false
  if (!isRecord(value.blocks)) return false
  for (const [id, block] of Object.entries(value.blocks)) {
    if (!id) return false
    if (!isRecord(block)) return false
    if (typeof block.content !== 'string') return false
  }
  return true
}

function decodeBase64Utf8(input: string): string | null {
  try {
    // Node 环境（Vitest）优先
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(input, 'base64').toString('utf-8')
    }

    // 浏览器环境
    if (typeof atob !== 'undefined') {
      const binary = atob(input)
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
      return new TextDecoder().decode(bytes)
    }

    return null
  } catch {
    return null
  }
}

function encodeBase64Utf8(input: string): string {
  // Node 环境（Vitest）优先
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf-8').toString('base64')
  }

  // 浏览器环境
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function stripMetaTag(markdown: string): { cleanMarkdown: string; removed: boolean } {
  // 宽松匹配：允许自闭合或显式闭合
  const metaTagRegex = new RegExp(`<${META_TAG_NAME}[^>]*>(?:\\s*<\\/${META_TAG_NAME}>\\s*)?`, 'gi')

  const has = metaTagRegex.test(markdown)
  if (!has) return { cleanMarkdown: markdown, removed: false }

  const cleaned = markdown.replace(metaTagRegex, '').trimEnd()
  return { cleanMarkdown: cleaned, removed: true }
}

export function extractCompareMetaFromMarkdown(markdown: string): ExtractCompareMetaResult {
  // 先尝试抓取最后一个 meta（避免中间插入导致误解析）
  const metaTagFullRegex = new RegExp(
    `<${META_TAG_NAME}[^>]*data-json="([^"]+)"[^>]*>(?:\\s*<\\/${META_TAG_NAME}>\\s*)?`,
    'gi'
  )

  let lastMatch: RegExpExecArray | null = null
  for (const match of markdown.matchAll(metaTagFullRegex)) {
    lastMatch = match as RegExpExecArray
  }

  if (!lastMatch) {
    return { cleanMarkdown: stripMetaTag(markdown).cleanMarkdown, meta: null }
  }

  const base64 = lastMatch[1]
  const decoded = decodeBase64Utf8(base64)
  if (!decoded) {
    // 解析失败时不移除，避免数据丢失
    return { cleanMarkdown: markdown, meta: null }
  }

  const parsed = safeJsonParse(decoded)
  if (!isCompareBlockMetaV1(parsed)) {
    // 解析失败时不移除，避免数据丢失
    return { cleanMarkdown: markdown, meta: null }
  }

  // 解析成功：移除 meta 标签，避免出现在编辑器/源码视图中
  const { cleanMarkdown } = stripMetaTag(markdown)
  return { cleanMarkdown, meta: parsed }
}

export function buildCompareMetaTag(meta: CompareBlockMeta): string {
  const json = JSON.stringify(meta)
  const base64 = encodeBase64Utf8(json)
  return `<${META_TAG_NAME} data-v="${meta.v}" data-json="${base64}"></${META_TAG_NAME}>`
}

export function appendCompareMetaToMarkdown(markdown: string, meta: CompareBlockMeta | null): string {
  const { cleanMarkdown } = stripMetaTag(markdown)

  const blocks = meta?.blocks ?? {}
  const hasBlocks = Object.keys(blocks).length > 0
  if (!meta || !hasBlocks) return cleanMarkdown.trimEnd()

  const tag = buildCompareMetaTag(meta)
  return `${cleanMarkdown.trimEnd()}\n\n${tag}\n`
}

export interface CompareBlockMarker {
  id: string
  collapsed: boolean
}

/**
 * Marker 行格式（建议）：
 * --- <!-- cs-compare-block:cb_xxx collapsed=1 -->
 */
export function parseCompareBlockMarkerLine(line: string): CompareBlockMarker | null {
  const m = line.match(/^---\s*<!--\s*cs-compare-block:([a-zA-Z0-9_-]+)(?:\s+collapsed=(0|1))?\s*-->\s*$/)
  if (!m) return null
  return {
    id: m[1],
    collapsed: m[2] ? m[2] === '1' : true
  }
}

export function buildCompareBlockMarkerLine(marker: CompareBlockMarker): string {
  return `--- <!-- cs-compare-block:${marker.id} collapsed=${marker.collapsed ? '1' : '0'} -->`
}

/**
 * 将 marker 行替换为 TipTap 可解析的自定义 HTML 标签（只用于渲染，不用于持久化展示）。
 */
export function replaceCompareMarkersForHtml(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  for (const line of lines) {
    const marker = parseCompareBlockMarkerLine(line)
    if (!marker) {
      out.push(line)
      continue
    }
    out.push(
      `<cs-compare-block data-id="${marker.id}" data-collapsed="${marker.collapsed ? '1' : '0'}"></cs-compare-block>`
    )
  }
  return out.join('\n')
}
