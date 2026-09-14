import * as z from 'zod'

import { type Access, assertAccess, refreshAccess } from './access'
import { decodeText, encodeText, type Meeting, parseMindMap } from './meeting'

const BASE_URL = 'https://work.sonicrhino.cc'
const statusSchema = z.object({ status: z.string(), analysis_status: z.string().optional() })
const summarySchema = z.object({
  summary_status: z.string(),
  summary: z.string(),
  summary_quality: z.object({ passed: z.boolean() }).optional()
})
const mapSchema = z.object({ mindmap_status: z.string(), MindMapSummary: z.array(z.unknown()) })
type Fetch = (
  input: Parameters<Window['cherry']['network']['fetch']>[0]
) => ReturnType<Window['cherry']['network']['fetch']>

export class MeetingClient {
  constructor(
    private readonly access: Access,
    private readonly fetch: Fetch = (input) => window.cherry.network.fetch(input)
  ) {}

  private async fetchText(url: string, signal: AbortSignal, body?: object): Promise<string> {
    const target = new URL(url, BASE_URL)
    if (target.origin !== BASE_URL || target.username || target.password) throw new Error('invalidResponse')
    signal.throwIfAborted()
    await refreshAccess(this.access, this.fetch)
    signal.throwIfAborted()
    const response = await this.fetch({
      url: target.href,
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: encodeText(JSON.stringify(body)) } : {})
    })
    signal.throwIfAborted()
    assertAccess(this.access)
    if (response.status === 429) throw new Error('serviceBusy')
    if (response.status === 422) throw new Error('textTooShort')
    if (response.status < 200 || response.status >= 300) throw new Error('serviceError')
    return decodeText(response.body)
  }

  private async request(path: string, signal: AbortSignal, body?: object): Promise<unknown> {
    return JSON.parse(await this.fetchText(`/api/v1/analyses${path}`, signal, body))
  }

  async visualSummary(taskId: string, signal: AbortSignal, start = false): Promise<string | null> {
    const value = z
      .object({ html_status: z.string(), html_url: z.string().optional() })
      .parse(await this.request(`/${encodeURIComponent(taskId)}/summary-image`, signal, start ? {} : undefined))
    if (value.html_status === 'failed') throw new Error('visualFailed')
    if (value.html_status !== 'ready') return null
    if (!value.html_url) throw new Error('invalidResponse')
    const html = (await this.fetchText(value.html_url, signal)).trim()
    if (!html || html.length > 1_000_000) throw new Error('invalidResponse')
    return html
  }

  async submit(meeting: Meeting, signal: AbortSignal): Promise<string> {
    const result = await this.request('', signal, {
      text: meeting.text,
      options: { summary_style: 'topic_minutes', source_type: 'transcript', source_title: meeting.title }
    })
    return z.object({ task_id: z.string().min(1).max(128) }).parse(result).task_id
  }

  async step(meeting: Meeting, signal: AbortSignal): Promise<Meeting> {
    if (!meeting.taskId) throw new Error('invalidResponse')
    const path = `/${encodeURIComponent(meeting.taskId)}`
    if (!meeting.summary) {
      const status = statusSchema.parse(await this.request(path, signal))
      if (status.status === 'failed' || status.status === 'canceled' || status.analysis_status === 'failed')
        throw new Error('serviceError')
      if (status.analysis_status !== 'ready') return meeting
      const summary = summarySchema.parse(await this.request(`${path}/summary`, signal))
      if (summary.summary_status === 'failed') throw new Error('serviceError')
      if (summary.summary_status !== 'ready') return meeting
      if (summary.summary_quality?.passed === false || !summary.summary.trim()) throw new Error('qualityFailed')
      return { ...meeting, summary: summary.summary.trim() }
    }
    if (!meeting.mindMap.length) {
      const map = mapSchema.parse(await this.request(`${path}/mindmap`, signal))
      if (map.mindmap_status === 'failed') throw new Error('mindMapFailed')
      if (map.mindmap_status !== 'ready') return meeting
      const nodes = parseMindMap(map.MindMapSummary)
      if (!nodes.length) throw new Error('mindMapFailed')
      return { ...meeting, mindMap: nodes }
    }
    return meeting
  }
}
