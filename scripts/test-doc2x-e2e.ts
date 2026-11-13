import * as z from 'zod'

const API_HOST = 'https://v2.doc2x.noedgeai.com'
const PDF_URL = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'
const POLL_INTERVAL_MS = 2_000
const MAX_WAIT_MS = 20 * 60_000
const apiKey = process.env.DOC2X_API_KEY

if (!apiKey) {
  throw new Error('DOC2X_API_KEY is required')
}

const responseSchema = z.object({
  code: z.string(),
  data: z.unknown().optional(),
  msg: z.string().optional(),
  message: z.string().optional()
})

const preuploadDataSchema = z.object({ uid: z.string().min(1), url: z.string().min(1) })
const blockSchema = z.object({
  id: z.string(),
  type: z.string(),
  text: z.string().default(''),
  bbox: z.array(z.number()).length(4),
  reading_order: z.number().int(),
  parent_id: z.string().default(''),
  src: z.string().default(''),
  linking: z.record(z.string(), z.unknown()).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  table_data: z.object({ html: z.string() }).optional()
})
const pageSchema = z.object({
  page_idx: z.number(),
  md: z.string().optional(),
  layout: z.object({ blocks: z.array(blockSchema) }).optional()
})
const parseDataSchema = z.object({
  status: z.enum(['processing', 'failed', 'success']),
  progress: z.number().optional(),
  detail: z.string().optional(),
  result: z.object({ pages: z.array(pageSchema).default([]) }).optional()
})
const optionalUrlSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.length === 0 ? undefined : value),
  z.string().min(1).optional()
)
const exportDataSchema = z.object({
  status: z.enum(['processing', 'failed', 'success']),
  url: optionalUrlSchema
})

type Block = z.infer<typeof blockSchema>
type Page = z.infer<typeof pageSchema>
type Model = 'v2' | 'v3-2026'

async function request(url: string, init: RequestInit = {}): Promise<unknown> {
  console.log(`${init.method ?? 'GET'} ${url}`)
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...init.headers
    }
  })
  const text = await response.text()
  console.log(`response=${response.status} ${response.statusText}`)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`)
  }
  return text ? JSON.parse(text) : undefined
}

async function downloadPdf(): Promise<Uint8Array> {
  console.log(`GET ${PDF_URL}`)
  const response = await fetch(PDF_URL)
  if (!response.ok) throw new Error(`PDF download failed: ${response.status}`)
  const pdf = new Uint8Array(await response.arrayBuffer())
  console.log(`PDF bytes=${pdf.byteLength}`)
  if (pdf.byteLength === 0) throw new Error('PDF download returned an empty body')
  return pdf
}

function parseResponse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = responseSchema.parse(value)
  if (parsed.code !== 'success') throw new Error(parsed.msg ?? parsed.message ?? parsed.code)
  return schema.parse(parsed.data)
}

function blocksToMarkdown(page: Page): { markdown: string; blocks: Block[]; filtered: Block[]; ordered: Block[] } {
  const blocks = page.layout?.blocks ?? []
  const filtered = blocks.filter((block) => block.attributes?.is_boilerplate !== true)
  const ordered = [...filtered].sort((a, b) => a.reading_order - b.reading_order)
  const markdown = ordered
    .map((block) => (block.type === 'Table' ? (block.table_data?.html ?? block.text) : block.text))
    .filter((text) => text.length > 0)
    .join('\n\n')
  return { markdown: markdown || page.md || '', blocks, filtered, ordered }
}

async function waitForParse(uid: string): Promise<Page[]> {
  const deadline = Date.now() + MAX_WAIT_MS
  while (Date.now() < deadline) {
    const data = parseResponse(parseDataSchema, await request(`${API_HOST}/api/v2/parse/status?uid=${uid}`))
    const pages = data.result?.pages ?? []
    console.log(`data.status=${data.status} progress=${data.progress ?? '-'} pages=${pages.length}`)
    if (data.status === 'failed') throw new Error(data.detail ?? 'parse failed')
    if (data.status === 'success') return pages
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`parse polling timed out after ${MAX_WAIT_MS}ms`)
}

async function triggerExport(uid: string, model: Model): Promise<string> {
  const isV3Model = model === 'v3-2026'
  const body = {
    uid,
    to: 'md',
    formula_mode: 'normal',
    ...(isV3Model ? { formula_level: 1, merge_cross_page_forms: true } : {})
  }
  console.log(`export body=${JSON.stringify(body)}`)
  const value = await request(`${API_HOST}/api/v2/convert/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  console.log(`model=${model} formula_level=${isV3Model ? 1 : '-'} merge_cross_page_forms=${isV3Model}`)
  const data = parseResponse(exportDataSchema, value)
  if (data.status === 'failed') throw new Error('export trigger failed')

  const deadline = Date.now() + MAX_WAIT_MS
  while (Date.now() < deadline) {
    const result = parseResponse(exportDataSchema, await request(`${API_HOST}/api/v2/convert/parse/result?uid=${uid}`))
    console.log(`data.status=${result.status}`)
    if (result.status === 'failed') throw new Error('export result failed')
    if (result.status === 'success' && result.url) return result.url
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`export polling timed out after ${MAX_WAIT_MS}ms`)
}

async function downloadZip(url: string, model: Model): Promise<void> {
  console.log(`GET ${new URL(url).origin} (export ZIP for ${model})`)
  const response = await fetch(url, { redirect: 'error' })
  if (!response.ok) throw new Error(`ZIP download failed: ${response.status}`)
  const zip = new Uint8Array(await response.arrayBuffer())
  console.log(`export ZIP bytes=${zip.byteLength} content-type=${response.headers.get('content-type') ?? '-'}`)
  if (zip.byteLength === 0) throw new Error(`empty export ZIP for ${model}`)
}

async function runModel(pdf: Uint8Array, model: Model): Promise<void> {
  console.log(`\n=== model ${model} ===`)
  const preuploadBody = { model }
  console.log(`preupload body=${JSON.stringify(preuploadBody)}`)
  const preupload = parseResponse(
    preuploadDataSchema,
    await request(`${API_HOST}/api/v2/parse/preupload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preuploadBody)
    })
  )
  console.log(`uid=${preupload.uid}`)

  const upload = await fetch(preupload.url, { method: 'PUT', body: pdf as unknown as BodyInit })
  console.log(`upload response=${upload.status} ${upload.statusText}`)
  if (!upload.ok) throw new Error(`upload failed: ${upload.status}`)

  const pages = await waitForParse(preupload.uid)
  const pageResults = pages.map(blocksToMarkdown)
  const rawBlocks = pageResults.flatMap((result) => result.blocks)
  const filteredBlocks = pageResults.flatMap((result) => result.filtered)
  const structuredMarkdown = pageResults
    .map((result) => result.markdown)
    .filter(Boolean)
    .join('\n\n')
  console.log(`blocks before filter=${rawBlocks.length}`)
  console.log(`blocks after filter=${filteredBlocks.length}`)
  console.log(`raw block ids=${rawBlocks.map((block) => block.id).join(',') || '-'}`)
  console.log(`filtered block ids=${filteredBlocks.map((block) => block.id).join(',') || '-'}`)
  console.log(`structured markdown bytes=${Buffer.byteLength(structuredMarkdown)}`)

  if (pages.some((page) => !page.md?.trim())) throw new Error(`${model} returned an empty page.md`)

  if (model === 'v2') {
    if (rawBlocks.length > 0) {
      console.warn('v2 returned non-empty layout.blocks; treating them as an additive provider response')
    }
  } else {
    if (rawBlocks.length === 0) throw new Error('v3-2026 returned no layout.blocks')
    const boilerplateBlocks = rawBlocks.filter((block) => block.attributes?.is_boilerplate === true)
    if (boilerplateBlocks.length > 0) {
      const filteredIds = new Set(filteredBlocks.map((block) => block.id))
      if (
        filteredBlocks.length !== rawBlocks.length - boilerplateBlocks.length ||
        boilerplateBlocks.some((block) => filteredIds.has(block.id))
      ) {
        throw new Error('boilerplate block was not filtered')
      }
    }
    for (const page of pages) {
      const orders = blocksToMarkdown(page).ordered.map((block) => block.reading_order)
      const sortedOrders = [...orders].sort((a, b) => a - b)
      if (orders.some((order, index) => order !== sortedOrders[index])) {
        throw new Error(`reading_order is not sorted on page ${page.page_idx}`)
      }
    }
    const tableBlock = filteredBlocks.find((block) => block.type === 'Table' && block.table_data?.html)
    if (tableBlock && !structuredMarkdown.includes(tableBlock.table_data?.html ?? '')) {
      throw new Error('table_data.html was not used in structured markdown')
    }
    if (!tableBlock) {
      console.warn('v3 response did not include a Table block; table HTML assertion was not applicable')
    }
    console.log(`table html block=${tableBlock?.id ?? '-'}`)
  }

  const exportUrl = await triggerExport(preupload.uid, model)
  await downloadZip(exportUrl, model)
}

async function main(): Promise<void> {
  const pdf = await downloadPdf()
  await runModel(pdf, 'v2')
  await runModel(pdf, 'v3-2026')
  console.log('\nDoc2X E2E passed')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
