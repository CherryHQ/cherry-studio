import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import type { IllustrationData } from '@shared/data/types/illustration'
import type { CherryUIMessage } from '@shared/data/types/message'

import { pipeStreamLoop } from '../pipeStreamLoop'
import { withIllustrations } from '../withIllustrations'

async function parse(deltas: string[], maxIllustrations = 1) {
  const chunks: UIMessageChunk[] = [
    { type: 'start', messageId: 'answer' },
    { type: 'text-start', id: 'text' },
    ...deltas.map((delta): UIMessageChunk => ({ type: 'text-delta', id: 'text', delta })),
    { type: 'text-end', id: 'text' },
    { type: 'finish' }
  ]
  const completed: IllustrationData[] = []
  let message: CherryUIMessage | undefined
  const stream = withIllustrations(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk))
        controller.close()
      }
    }),
    {
      start: (id) => ({ id, revision: 0, prompt: '', status: 'prompting' }),
      complete: (id, prompt, valid) => {
        const data: IllustrationData = {
          id,
          revision: 1,
          prompt,
          status: valid ? 'generating' : 'error',
          ...(!valid && { error: 'incomplete' })
        }
        completed.push(data)
        return data
      }
    },
    maxIllustrations
  )
  const broadcast: UIMessageChunk[] = []
  const result = await pipeStreamLoop(stream, new AbortController().signal, {
    onChunk: (chunk) => broadcast.push(structuredClone(chunk)),
    onAccumulatedSnapshot: (snapshot) => {
      message = snapshot
    }
  })
  expect(result.accumulationError).toBeUndefined()
  return { parts: message?.parts ?? [], completed, broadcast }
}

describe('inline illustration stream contract', () => {
  // Catches split delimiters leaking prompt text or collapsing text after the image.
  it('preserves text/image/text order for every delimiter split and one-character deltas', async () => {
    const reply = 'Before\n[[IMAGE]]\na red bird\n[[/IMAGE]]\nAfter'
    for (const deltas of [
      [...reply],
      ...Array.from({ length: reply.length + 1 }, (_, i) => [reply.slice(0, i), reply.slice(i)])
    ]) {
      const { parts, completed } = await parse(deltas)
      expect(parts.map((part) => part.type)).toEqual(['text', 'data-illustration', 'text'])
      expect(parts[0]).toMatchObject({ text: 'Before\n' })
      expect(parts[2]).toMatchObject({ text: '\nAfter' })
      expect(completed).toHaveLength(1)
      expect(completed[0]).toMatchObject({ status: 'generating', prompt: 'a red bird' })
    }
  })

  it('reserves a placeholder as soon as the opening marker arrives and keeps image work out of the text stream', async () => {
    const { broadcast, parts } = await parse(['[[IMAGE]]', 'a prompt', '[[/IMAGE]]\nText continues'])
    expect(broadcast.find((chunk) => chunk.type === 'data-illustration')).toMatchObject({
      data: { status: 'prompting' }
    })
    expect(parts.at(-1)).toMatchObject({ type: 'text', text: '\nText continues' })
  })

  it('leaves fenced, inline and indented code examples as ordinary text', async () => {
    const text = '```text\n[[IMAGE]]\nexample\n[[/IMAGE]]\n```\n`[[IMAGE]]`\n    [[IMAGE]]\n'
    const { parts, completed } = await parse([...text])
    expect(completed).toEqual([])
    expect(parts).toEqual([{ type: 'text', text, state: 'done' }])
  })

  describe('multiline code span regression', () => {
    // Code examples must never submit their illustration markers as image requests.
    it.each([
      ['single backticks', '`example\n[[IMAGE]]\nprivate example\n[[/IMAGE]]\n`'],
      ['matching double backticks', '``example ` literal\n[[IMAGE]]\nprivate example\n[[/IMAGE]]\n``'],
      ['backslashes inside code', '``example \\`\n[[IMAGE]]\nprivate example\n[[/IMAGE]]\n``']
    ])('preserves markers inside %s', async (_name, text) => {
      const { parts, completed } = await parse([...text])
      expect(completed).toEqual([])
      expect(parts).toEqual([{ type: 'text', text, state: 'done' }])
    })

    it.each(['`example\ncode`', '`example\\`', 'escaped \\`', '```markdown\n`\n```'])(
      'recognizes illustrations after %s',
      async (prefix) => {
        const { parts, completed } = await parse([...`${prefix}\n[[IMAGE]]a red bird[[/IMAGE]]\nAfter`])
        expect(completed).toEqual([expect.objectContaining({ status: 'generating', prompt: 'a red bird' })])
        expect(parts.map((part) => part.type)).toEqual(['text', 'data-illustration', 'text'])
        expect(parts[0]).toMatchObject({ text: `${prefix}\n` })
        expect(parts[2]).toMatchObject({ text: '\nAfter' })
      }
    )
  })

  it('hides a truncated prompt and records a terminal failure', async () => {
    const { parts, completed } = await parse(['Kept\n[[IMAGE]]\nprivate unfinished prompt'])
    expect(parts).toEqual([
      { type: 'text', text: 'Kept\n', state: 'done' },
      expect.objectContaining({
        type: 'data-illustration',
        data: expect.objectContaining({ status: 'error', error: 'incomplete', prompt: '' })
      })
    ])
    expect(completed).toHaveLength(1)
  })

  it('assigns independent identities and positions to multiple illustrations', async () => {
    const { parts, completed } = await parse(['[[IMAGE]]first[[/IMAGE]]\nMiddle\n[[IMAGE]]second[[/IMAGE]]'], 2)
    expect(parts.map((part) => part.type)).toEqual(['data-illustration', 'text', 'data-illustration'])
    expect(completed.map((data) => data.prompt)).toEqual(['first', 'second'])
    expect(completed[0].id).not.toBe(completed[1].id)
  })

  it('does not reserve or submit illustrations after the per-reply limit', async () => {
    const { parts, completed } = await parse(
      ['[[IMAGE]]first[[/IMAGE]]\nMiddle\n[[IMAGE]]over-limit prompt[[/IMAGE]]\nEnd'],
      1
    )
    expect(parts.filter((part) => part.type === 'data-illustration')).toHaveLength(1)
    expect(completed.map((data) => data.prompt)).toEqual(['first'])
    const visibleText = parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
    expect(visibleText).toContain('Middle')
    expect(visibleText).toContain('End')
    expect(visibleText).not.toContain('over-limit prompt')
  })

  // Catches the closing-marker buffer letting an oversized prompt bypass the length limit.
  it.each([16000, 16001, 16012])('bounds a %i-character prompt without consuming subsequent text', async (length) => {
    const { parts, completed } = await parse([`[[IMAGE]]${'x'.repeat(length)}[[/IMAGE]]\nAfter`])
    expect(completed[0].status).toBe(length <= 16000 ? 'generating' : 'error')
    expect(parts.at(-1)).toMatchObject({ type: 'text', text: '\nAfter' })
  })
})
