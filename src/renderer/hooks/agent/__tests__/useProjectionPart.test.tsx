import { projectionIpc } from '@test-mocks/renderer/ProjectionIpc'
import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { MessageProjectionService } from '@renderer/services/aiTransport/MessageProjectionService'
import type { ProjectionPartReader } from '@renderer/types/message'
import type { ProjectionTarget } from '@shared/ai/messageProjection'

import { ProjectionPartContext, useProjectionPart } from '../useProjectionPart'

afterEach(() => vi.restoreAllMocks())

function Cell({ id }: { id: string }) {
  const value = useProjectionPart(id)
  return <output data-testid={id}>{value?.type === 'text' ? value.text : ''}</output>
}

it('applies a revision before waking a mounted cell, isolates the other target and rebinds recycled cells', async () => {
  const ipc = projectionIpc()
  const store = new MessageProjectionService()
  const root: ProjectionTarget = { kind: 'topic', topicId: 'root' }
  const child: ProjectionTarget = { kind: 'child', sessionId: 'root', toolCallId: 'child' }
  const rootReader = store.partsFor(root)
  const childReader = store.partsFor(child)
  const readChild = vi.spyOn(childReader, 'read')
  function Rows({ reader }: { reader: ProjectionPartReader }) {
    return (
      <>
        <ProjectionPartContext value={reader}>
          <Cell id="active" />
        </ProjectionPartContext>
        <ProjectionPartContext value={childReader}>
          <Cell id="other" />
        </ProjectionPartContext>
      </>
    )
  }
  const rows = render(<Rows reader={rootReader} />)
  const [a, b] = ipc.attachments
  const topic = { kind: 'topic' as const, topicId: 'root', executions: [] }
  const config = {
    kind: 'child' as const,
    sessionId: 'child',
    contextId: 'ctx',
    active: true,
    available: true,
    canSubmit: true
  }
  const message = (text: string) => ({
    id: 'row',
    role: 'assistant' as const,
    partIds: ['active', 'other'],
    parts: [
      { type: 'text' as const, state: 'streaming' as const, text },
      { type: 'text' as const, state: 'streaming' as const, text: 'other' }
    ]
  })
  await act(async () => {
    a.resolve({ ...topic, revision: 0, messages: [message('a')] })
    b.resolve({ ...config, revision: 0, messages: [message('child')] })
  })
  const seen: (string | undefined)[] = []
  const off = rootReader.subscribe('active', () => {
    const value = rootReader.read('active')
    seen.push(value?.type === 'text' ? value.text : undefined)
  })
  readChild.mockClear()
  act(() =>
    ipc.emit(a.subscriptionId, {
      kind: 'topic',
      type: 'parts',
      revision: 1,
      patches: [
        { type: 'part-append', partId: 'active', text: 'b' },
        { type: 'part-append', partId: 'active', text: 'c' },
        { type: 'part-finish', partId: 'active' }
      ]
    })
  )
  expect(screen.getByTestId('active').textContent).toBe('abc')
  expect(seen).toEqual(['abc'])
  expect(readChild).not.toHaveBeenCalled()
  expect(ipc.attachments).toHaveLength(2)
  act(() =>
    ipc.emit(b.subscriptionId, {
      kind: 'child',
      type: 'parts',
      revision: 1,
      patches: [
        { type: 'part-append', partId: 'other', text: 'lost' },
        { type: 'part-finish', partId: 'missing' }
      ]
    })
  )
  expect(childReader.read('other')).toMatchObject({ text: 'other' })
  await act(async () => ipc.attachments[2].resolve({ ...config, revision: 1, messages: [message('recovered child')] }))
  rows.rerender(<Rows reader={childReader} />)
  off()
  act(() =>
    ipc.emit(a.subscriptionId, {
      kind: 'topic',
      type: 'parts',
      revision: 2,
      patches: [{ type: 'part-append', partId: 'other', text: 'late' }]
    })
  )
  expect(screen.getByTestId('active').textContent).toBe('recovered child')
  expect(screen.getByTestId('other').textContent).toBe('other')
  rows.unmount()
  expect(ipc.detached).toContain(ipc.attachments[2].subscriptionId)
})
