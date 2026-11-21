import { expect, it } from 'vitest'

import { ACCOUNT_URL } from './access'
import { decodeText, encodeText, importMeeting } from './meeting'
import { MeetingClient } from './meetingClient'

const grant = () => ({ token: 'test-secret', userId: 'user-1', revoked: false })
const signal = new AbortController().signal
const response = (value: unknown) => ({ status: 200, headers: {}, body: encodeText(JSON.stringify(value)) })

it('uploads only the transcript and options, never the local access identity', async () => {
  const client = new MeetingClient(grant(), async (input) => {
    if (input.url === ACCOUNT_URL) return response({ code: 1, data: { user: { id: 'user-1' } } })
    expect(input.url).toBe('https://work.sonicrhino.cc/api/v1/analyses')
    expect(input.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(decodeText(input.body!))).toEqual({
      text: '王丽：下周交付。',
      options: {
        summary_style: 'topic_minutes',
        source_type: 'transcript',
        source_title: '讨论'
      }
    })
    return response({ task_id: 'task-1' })
  })
  await expect(client.submit(importMeeting('讨论.txt', '王丽：下周交付。'), signal)).resolves.toBe('task-1')
})

it('delivers a valid summary as a checkpoint before requesting the independent mind map', async () => {
  const client = new MeetingClient(grant(), async ({ url }) => {
    if (url === ACCOUNT_URL) return response({ code: 1, data: { user: { id: 'user-1' } } })
    if (url.endsWith('/summary'))
      return response({ summary_status: 'ready', summary: '已决定下周交付。', summary_quality: { passed: true } })
    if (url.endsWith('/mindmap')) return response({ mindmap_status: 'failed', MindMapSummary: [] })
    return response({ status: 'succeeded', analysis_status: 'ready' })
  })
  const meeting = { ...importMeeting('讨论.txt', '王丽：下周交付。'), taskId: 'task-1' }
  const checkpoint = await client.step(meeting, signal)
  expect(checkpoint.summary).toBe('已决定下周交付。')
  await expect(client.step(checkpoint, signal)).rejects.toThrow('mindMapFailed')
  expect(checkpoint.summary).toBe('已决定下周交付。')
})

it('refuses summaries that failed the quality gate', async () => {
  const client = new MeetingClient(grant(), async ({ url }) =>
    response(
      url === ACCOUNT_URL
        ? { code: 1, data: { user: { id: 'user-1' } } }
        : url.endsWith('/summary')
          ? { summary_status: 'ready', summary: 'Unreliable', summary_quality: { passed: false } }
          : { status: 'succeeded', analysis_status: 'ready' }
    )
  )
  await expect(
    client.step({ ...importMeeting('test.txt', 'Some transcript'), taskId: 'task' }, signal)
  ).rejects.toThrow('qualityFailed')
})

it('does not deliver a response after waiting was cancelled', async () => {
  const abort = new AbortController()
  const client = new MeetingClient(grant(), async () => {
    abort.abort()
    return response({ task_id: 'task' })
  })
  await expect(client.submit(importMeeting('test.txt', 'Some transcript'), abort.signal)).rejects.toThrow()
})

it('blocks transcript upload when the account service revokes the token', async () => {
  const destinations: string[] = []
  const client = new MeetingClient(grant(), async ({ url }) => {
    destinations.push(url)
    return response({ code: 0, msg: 'revoked' })
  })
  await expect(client.submit(importMeeting('test.txt', 'Private meeting'), signal)).rejects.toThrow('accessExpired')
  expect(destinations).toEqual([ACCOUNT_URL])
})

it('blocks transcript upload when verification is unavailable', async () => {
  const destinations: string[] = []
  const client = new MeetingClient(grant(), async ({ url }) => {
    destinations.push(url)
    throw new Error('network error')
  })
  await expect(client.submit(importMeeting('test.txt', 'Private meeting'), signal)).rejects.toThrow('authUnavailable')
  expect(destinations).toEqual([ACCOUNT_URL])
})

it('fetches the formatted report from the summary origin without forwarding the account token', async () => {
  const client = new MeetingClient(grant(), async (input) => {
    if (input.url === ACCOUNT_URL) return response({ code: 1, data: { user: { id: 'user-1' } } })
    expect(input.headers).not.toHaveProperty('token')
    if (input.url.endsWith('/summary-image'))
      return response({ html_status: 'ready', html_url: '/reports/meeting.html' })
    expect(input.url).toBe('https://work.sonicrhino.cc/reports/meeting.html')
    return { status: 200, headers: {}, body: encodeText('<h1>会议总结</h1>') }
  })
  await expect(client.visualSummary('task-1', signal, true)).resolves.toBe('<h1>会议总结</h1>')
})

it('refuses a formatted-report URL on another origin before sending it a request', async () => {
  const destinations: string[] = []
  const client = new MeetingClient(grant(), async ({ url }) => {
    destinations.push(url)
    if (url === ACCOUNT_URL) return response({ code: 1, data: { user: { id: 'user-1' } } })
    return response({ html_status: 'ready', html_url: 'https://untrusted.example/report.html' })
  })
  await expect(client.visualSummary('task-1', signal, true)).rejects.toThrow('invalidResponse')
  expect(destinations.some((url) => url.includes('untrusted.example'))).toBe(false)
})
