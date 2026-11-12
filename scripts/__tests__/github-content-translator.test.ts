import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(readFileSync('.github/workflows/github-content-translator.yml', 'utf8'))
const script = workflow.jobs.translate.steps[0].with.script
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const originalSummary = '<summary>Original Content</summary>'
const title = '无法发送消息'
const noUpdate = {
  should_update: false,
  translated_title: null,
  translated_body: null,
  original_body: null
}

type Input = {
  event: string
  target: { kind: string; title: string; body: string }
  context?: { title: string; body: string }
  chunk?: { index: number; total: number; start: number; end: number }
}

const translated = (body: string, original: string, translatedTitle: string | null = null) => ({
  should_update: true,
  translated_title: translatedTitle,
  translated_body: body,
  original_body: original
})

const response = (result: unknown, overrides = {}) => ({
  id: 'msg_fixture',
  model: 'translation-model',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(result) }],
  usage: { output_tokens: 100 },
  ...overrides
})

function setup(
  body: string,
  reply: (input: Input, index: number) => unknown,
  options: {
    event?: string
    title?: string
    action?: string
    previousBody?: string
    httpStatus?: number
    httpFailureAt?: number
  } = {}
) {
  const requests: { url: string; options: RequestInit; input: Input; body: Record<string, any> }[] = []
  const writes: { route: string; data: Record<string, any> }[] = []
  const event = options.event ?? 'issues'
  const write = (route: string) => async (data: Record<string, any>) => {
    writes.push({ route, data })
  }
  const github = {
    rest: {
      issues: { update: write('issues.update'), updateComment: write('issues.updateComment') },
      pulls: { updateReviewComment: write('pulls.updateReviewComment') }
    },
    request: async (route: string, data: Record<string, any>) => write(route)(data)
  }
  const context = {
    eventName: event,
    repo: { owner: 'CherryHQ', repo: 'cherry-studio' },
    payload: {
      action: options.action ?? 'opened',
      issue: { number: 24203, title: options.title ?? title, body },
      comment: { id: 123, body },
      review: { id: 456, body },
      pull_request: { number: 42 },
      changes: options.previousBody === undefined ? undefined : { body: { from: options.previousBody } }
    }
  }
  const fetch = async (url: string, requestOptions: RequestInit) => {
    const requestBody = JSON.parse(String(requestOptions.body))
    const input = JSON.parse(requestBody.messages[0].content) as Input
    const index = requests.length
    requests.push({ url, options: requestOptions, input, body: requestBody })
    expect(writes, 'GitHub must remain untouched until every translation succeeds').toEqual([])
    const result = reply(input, index)
    const status = index === (options.httpFailureAt ?? 0) ? (options.httpStatus ?? 200) : 200
    return {
      ok: status < 400,
      status,
      text: async () => 'Service unavailable',
      json: async () => result
    }
  }
  const run = () =>
    new AsyncFunction('github', 'context', 'core', 'process', 'fetch', script)(
      github,
      context,
      { info() {}, startGroup() {}, endGroup() {} },
      {
        env: {
          ANTHROPIC_API_KEY: 'fixture-key',
          ANTHROPIC_BASE_URL: 'https://translator.example.test/',
          ANTHROPIC_MODEL: 'translation-model'
        }
      },
      fetch
    )
  return { run, requests, writes }
}

function sections(body: string) {
  const separator = '\n\n---\n<details>\n' + originalSummary + '\n\n'
  const [translation, original] = body.split(separator)
  expect(original).toBeDefined()
  return {
    translation: translation.slice(translation.indexOf('\n\n') + 2),
    original: original.slice(0, -'\n</details>'.length)
  }
}

function expectPartition(requests: ReturnType<typeof setup>['requests'], body: string, documentTitle = title) {
  expect(requests.length).toBeGreaterThan(1)
  expect(requests.map(({ input }) => input.target.body).join('')).toBe(body)
  let offset = 0
  for (const [index, { input }] of requests.entries()) {
    expect(Array.from(input.target.body).length).toBeLessThanOrEqual(2000)
    expect(input.target.body.length).toBeGreaterThan(0)
    expect(input.context).toEqual({ title: documentTitle, body })
    expect(input.chunk).toEqual({
      index: index + 1,
      total: requests.length,
      start: offset,
      end: offset + input.target.body.length
    })
    expect(input.target.body).toBe(body.slice(input.chunk!.start, input.chunk!.end))
    expect(input.target.title).toBe(index === 0 ? documentTitle : '')
    offset += input.target.body.length
  }
  expect(offset).toBe(body.length)
}

describe('GitHub content translator workflow', () => {
  it('keeps the short-content request protocol and writes the translated issue once', async () => {
    const run = setup('不能发送。', () => response(translated('Cannot send.', '不能发送。', 'Cannot send messages')))
    await run.run()
    expect(run.requests).toHaveLength(1)
    const request = run.requests[0]
    expect(request.url).toBe('https://translator.example.test/v1/messages')
    expect(request.options.method).toBe('POST')
    expect(request.options.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'fixture-key',
      'anthropic-version': '2023-06-01'
    })
    expect(request.body).toMatchObject({ model: 'translation-model', max_tokens: 4096, temperature: 0 })
    expect(request.body.messages).toHaveLength(1)
    expect(request.body.messages[0].role).toBe('user')
    expect(request.input).toEqual({
      event: 'issues',
      target: { kind: 'issue', issueNumber: 24203, title, body: '不能发送。' }
    })
    expect(run.writes).toEqual([
      {
        route: 'issues.update',
        data: {
          owner: 'CherryHQ',
          repo: 'cherry-studio',
          issue_number: 24203,
          title: 'Cannot send messages',
          body:
            '> This issue was translated automatically.\n\nCannot send.\n\n---\n<details>\n' +
            originalSummary +
            '\n\n不能发送。\n</details>'
        }
      }
    ])
  })

  it('keeps exactly 2000 Unicode characters in one request', async () => {
    const body = '😀'.repeat(2000)
    const run = setup(body, () => response(noUpdate))
    await run.run()
    expect(run.requests).toHaveLength(1)
    expect(run.requests[0].input.target.body).toBe(body)
    expect(run.writes).toEqual([])
  })

  it('translates long Chinese paragraphs at newline boundaries and retains every source paragraph', async () => {
    const paragraphs = ['甲'.repeat(1500), '乙'.repeat(1500), '丙'.repeat(1500)]
    const body = paragraphs.join('\n\n')
    const english = ['First paragraph.', 'Second paragraph.', 'Third paragraph.']
    const run = setup(body, (input, index) =>
      response(
        translated(
          english[index],
          input.target.body.trim(),
          index === 0 ? 'Cannot send messages' : 'Ignored later title'
        )
      )
    )
    await run.run()
    expectPartition(run.requests, body)
    expect(run.requests.map(({ input }) => input.target.body)).toEqual([
      paragraphs[0] + '\n\n',
      paragraphs[1] + '\n\n',
      paragraphs[2]
    ])
    expect(run.writes).toHaveLength(1)
    expect(run.writes[0].data.title).toBe('Cannot send messages')
    expect(sections(run.writes[0].data.body)).toEqual({ translation: english.join('\n\n'), original: body })
  })

  it('retains indentation and newline separators even when translated fragments omit boundary whitespace', async () => {
    const body = '  ' + '甲'.repeat(1990) + '\r\n\r\n\t' + '乙'.repeat(200)
    const run = setup(body, (input, index) =>
      response(translated(index === 0 ? 'First.' : 'Second.', input.target.body.trim()))
    )
    await run.run()
    expectPartition(run.requests, body)
    expect(sections(run.writes[0].data.body)).toEqual({ translation: 'First.\r\n\r\n\tSecond.', original: body.trim() })
  })

  it('splits long lines by Unicode code point without breaking surrogate pairs', async () => {
    const body = '😀'.repeat(2001)
    const run = setup(body, (input) => response(translated(input.target.body, input.target.body)))
    await run.run()
    expectPartition(run.requests, body)
    expect(run.requests.map(({ input }) => Array.from(input.target.body).length)).toEqual([2000, 1])
    expect(sections(run.writes[0].data.body)).toEqual({ translation: body, original: body })
  })

  it.each([
    ['trailing space in the first fragment', ['The message ', 'cannot be sent.']],
    ['leading space in the second fragment', ['The message', ' cannot be sent.']]
  ])('preserves translated word boundaries after a hard cut: %s', async (_label, english) => {
    const body = '甲'.repeat(2001)
    const run = setup(body, (input, index) => response(translated(english[index], input.target.body)))
    await run.run()
    expectPartition(run.requests, body)
    expect(run.writes).toHaveLength(1)
    expect(sections(run.writes[0].data.body)).toEqual({
      translation: 'The message cannot be sent.',
      original: body
    })
  })

  it('reassembles code fences and links crossing fragment boundaries with controlled identity responses', async () => {
    const code = '```typescript\nconst value = "' + '甲'.repeat(2100) + '"\n```\n'
    const body = code + '[文档](https://example.test/' + 'a'.repeat(2100) + ')'
    const run = setup(body, (input) => response(translated(input.target.body, input.target.body)))
    await run.run()
    expectPartition(run.requests, body)
    expect(sections(run.writes[0].data.body)).toEqual({ translation: body, original: body })
  })

  it('retains an unchanged fragment exactly when another fragment needs translation', async () => {
    const unchanged = '  Already English. ' + 'a'.repeat(1950) + '\n\n'
    const body = unchanged + '需要翻译。'.repeat(40)
    const run = setup(body, (input, index) =>
      response(index === 0 ? noUpdate : translated('Needs translation.', input.target.body))
    )
    await run.run()
    expectPartition(run.requests, body)
    expect(sections(run.writes[0].data.body)).toEqual({
      translation: unchanged.trimStart() + 'Needs translation.',
      original: body.trim()
    })
  })

  it('does not write when every fragment reports no update', async () => {
    const body = 'Already English.\n'.repeat(300)
    const run = setup(body, () => response(noUpdate))
    await run.run()
    expectPartition(run.requests, body)
    expect(run.writes).toEqual([])
  })

  it('passes the entire long matching translation as context and leaves it unchanged with controlled no-update responses', async () => {
    const body =
      '> This issue was translated automatically.\n\n' +
      'Original paragraph.\n'.repeat(200) +
      '\n---\n<details>\n' +
      originalSummary +
      '\n\n' +
      '原始段落。\n'.repeat(500) +
      '</details>'
    const run = setup(body, () => response(noUpdate), { title: 'Original title' })
    await run.run()
    expectPartition(run.requests, body, 'Original title')
    expect(run.writes).toEqual([])
  })

  it('assembles controlled corrections to a long user-edited translation without retaining obsolete wrappers or English', async () => {
    const source = '甲'.repeat(3200)
    const prefix =
      '> This comment was translated automatically.\n\n' +
      'Stale English paragraph.\n'.repeat(200) +
      '\n---\n<details>\n' +
      originalSummary +
      '\n\n'
    const body = prefix + source + '\n</details>'
    const run = setup(
      body,
      (input) => {
        const start = Math.max(input.chunk!.start, prefix.length)
        const end = Math.min(input.chunk!.end, prefix.length + source.length)
        const sourceLength = Math.max(0, end - start)
        return response(translated('A'.repeat(sourceLength), '甲'.repeat(sourceLength)))
      },
      {
        event: 'issue_comment',
        action: 'edited',
        previousBody: prefix + '旧原文' + '\n</details>'
      }
    )
    await run.run()
    expectPartition(run.requests, body, '')
    expect(run.writes).toHaveLength(1)
    const updatedBody = run.writes[0].data.body
    expect(sections(updatedBody)).toEqual({ translation: 'A'.repeat(3200), original: source })
    expect(updatedBody.match(/This comment was translated automatically\./g)).toHaveLength(1)
    expect(updatedBody.match(/<details>/g)).toHaveLength(1)
    expect(updatedBody.match(/<summary>Original Content<\/summary>/g)).toHaveLength(1)
    expect(updatedBody).not.toContain('Stale English')
    expect(updatedBody).not.toContain('旧原文')
  })

  it('assembles controlled cleanup across email-history fragments while retaining the new reply', async () => {
    const body = '新的回复\n\nOn Monday, someone wrote:\n' + ('> ' + '旧邮件'.repeat(800) + '\n').repeat(3)
    const run = setup(body, (_input, index) =>
      response(index === 0 ? translated('New reply', '新的回复') : translated('', ''))
    )
    await run.run()
    expectPartition(run.requests, body)
    expect(run.requests.length).toBeGreaterThan(3)
    expect(run.writes).toHaveLength(1)
    expect(sections(run.writes[0].data.body)).toEqual({ translation: 'New reply', original: '新的回复' })
    expect(run.writes[0].data.body).not.toContain('Monday')
    expect(run.writes[0].data.body).not.toContain('旧邮件')
  })

  it('retains a controlled assembled translation longer than 16384 characters without truncating any fragment', async () => {
    const paragraphs = Array.from({ length: 10 }, () => '甲'.repeat(1800))
    const body = paragraphs.join('\n\n')
    const english = Array.from({ length: 10 }, (_value, index) => `English ${index} `.repeat(180).trim())
    const expectedTranslation = english.join('\n\n')
    expect(expectedTranslation.length).toBeGreaterThan(16384)
    const run = setup(body, (input, index) => response(translated(english[index], input.target.body)))
    await run.run()
    expectPartition(run.requests, body)
    expect(run.requests).toHaveLength(10)
    expect(run.writes).toHaveLength(1)
    expect(sections(run.writes[0].data.body)).toEqual({ translation: expectedTranslation, original: body })
  })

  it.each(['issues', 'issue_comment', 'pull_request_review', 'pull_request_review_comment'])(
    'does not write short English content for %s',
    async (event) => {
      const run = setup('Already English.', () => response(noUpdate), { event, title: 'English title' })
      await run.run()
      expect(run.requests).toHaveLength(1)
      expect(run.requests[0].input.target.body).toBe('Already English.')
      expect(run.writes).toEqual([])
    }
  )

  it('allows translating an issue title with an empty body', async () => {
    const run = setup('', () => response(translated('', '', 'Cannot send messages')))
    await run.run()
    expect(run.requests).toHaveLength(1)
    expect(run.requests[0].input.target.body).toBe('')
    expect(run.writes).toHaveLength(1)
    expect(run.writes[0].data.title).toBe('Cannot send messages')
    expect(sections(run.writes[0].data.body)).toEqual({ translation: '', original: '' })
  })

  it('accepts empty cleanup output and does not restore removed email history', async () => {
    const body = '> On Monday, someone wrote:\n> 旧邮件'
    const run = setup(body, () => response(translated('', '')))
    await run.run()
    expect(sections(run.writes[0].data.body)).toEqual({ translation: '', original: '' })
    expect(run.writes[0].data.body).not.toContain('Monday')
  })

  it('uses cleaned email originals returned by the translator', async () => {
    const body = '新的回复\n\nOn Monday, someone wrote:\n> 旧邮件'
    const run = setup(body, () => response(translated('New reply', '新的回复')))
    await run.run()
    expect(sections(run.writes[0].data.body)).toEqual({ translation: 'New reply', original: '新的回复' })
  })

  it.each([
    ['issue_comment', 'issues.updateComment', { comment_id: 123 }],
    [
      'pull_request_review',
      'PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}',
      { pull_number: 42, review_id: 456 }
    ],
    ['pull_request_review_comment', 'pulls.updateReviewComment', { comment_id: 123 }]
  ])('preserves the GitHub update route for %s', async (event, route, identifiers) => {
    const run = setup('中文', () => response(translated('Chinese', '中文')), { event })
    await run.run()
    expect(run.writes).toHaveLength(1)
    expect(run.writes[0]).toMatchObject({ route, data: { owner: 'CherryHQ', repo: 'cherry-studio', ...identifiers } })
    expect(run.writes[0].data.title).toBeUndefined()
    expect(sections(run.writes[0].data.body)).toEqual({ translation: 'Chinese', original: '中文' })
  })

  it('skips the edit event emitted by the workflow itself', async () => {
    const body =
      '> This comment was translated automatically.\n\nEnglish\n\n---\n<details>\n' +
      originalSummary +
      '\n\n中文\n</details>'
    const run = setup(
      body,
      () => {
        throw new Error('Must not request translation')
      },
      { event: 'issue_comment', action: 'edited', previousBody: '中文' }
    )
    await run.run()
    expect(run.requests).toEqual([])
    expect(run.writes).toEqual([])
  })

  it('leaves existing matching translations unchanged when the API reports no update', async () => {
    const body =
      '> This issue was translated automatically.\n\nEnglish\n\n---\n<details>\n' +
      originalSummary +
      '\n\n中文\n</details>'
    const run = setup(body, () => response(noUpdate))
    await run.run()
    expect(run.requests).toHaveLength(1)
    expect(run.requests[0].input.target.body).toBe(body)
    expect(run.writes).toEqual([])
  })

  it.each([
    ['incomplete JSON', [{ type: 'text', text: '{"should_update":true' }]],
    ['no text', []]
  ])('rejects later max_tokens responses before parsing or checking missing text (%s)', async (_label, content) => {
    const body = '甲'.repeat(2001)
    const run = setup(body, (input, index) =>
      index === 0
        ? response(translated('First', input.target.body))
        : response(null, { content, stop_reason: 'max_tokens', usage: { output_tokens: 4096 } })
    )
    await expect(run.run()).rejects.toThrow(/truncated.*(?:chunk|fragment) 2\/2.*1 body characters/i)
    expect(run.requests).toHaveLength(2)
    expect(run.writes).toEqual([])
  })

  it.each([
    ['invalid JSON', { content: [{ type: 'text', text: '{"should_update":' }] }],
    ['missing text', { content: [] }],
    [
      'missing result fields',
      { content: [{ type: 'text', text: JSON.stringify({ should_update: true, translated_body: 'Second' }) }] }
    ]
  ])('never writes an earlier successful fragment after later %s', async (_label, overrides) => {
    const run = setup('甲'.repeat(2001), (input, index) =>
      index === 0 ? response(translated('First', input.target.body)) : response(null, overrides)
    )
    await expect(run.run()).rejects.toThrow()
    expect(run.requests).toHaveLength(2)
    expect(run.writes).toEqual([])
  })

  it.each([0, 1])('reports HTTP failures on request %i without writing to GitHub', async (httpFailureAt) => {
    const run = setup('甲'.repeat(2001), (input) => response(translated('Translated', input.target.body)), {
      httpStatus: 503,
      httpFailureAt
    })
    await expect(run.run()).rejects.toThrow('Translator API failed with 503: Service unavailable')
    expect(run.requests).toHaveLength(httpFailureAt + 1)
    expect(run.writes).toEqual([])
  })
})
