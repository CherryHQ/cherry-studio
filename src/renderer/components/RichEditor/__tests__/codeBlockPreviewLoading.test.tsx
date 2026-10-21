import { act, render, screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { expect, it, vi } from 'vitest'

import RichEditor from '../RichEditor'

const previewLoad = vi.hoisted(() => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
})

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeShikiTheme: 'one-light' })
}))
vi.mock('@renderer/components/Preview/OpenUiPreview', async (importOriginal) => {
  await previewLoad.promise
  return importOriginal()
})

it('keeps the editor mounted while an OpenUI preview loads', async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  render(
    <Suspense fallback={<p role="status">Loading editor</p>}>
      <RichEditor
        autoFocus={false}
        initialContent={'# Keep editor available\n\n```openui\nroot = Panel("Release summary", [Text("Ready")])\n```'}
      />
    </Suspense>
  )

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Keep editor available' })).toBeVisible())
  expect(screen.queryByRole('status')).not.toBeInTheDocument()

  await act(async () => {
    previewLoad.resolve()
  })
  expect(await screen.findByRole('heading', { name: 'Release summary' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Keep editor available' })).toBeVisible()
})
