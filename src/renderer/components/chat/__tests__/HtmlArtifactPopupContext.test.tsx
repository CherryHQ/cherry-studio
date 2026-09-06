// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  HtmlArtifactPopupHost,
  useApprovedInteractiveHtml,
  useHtmlArtifactPopupActions,
  useHtmlArtifactPopupSession,
  useIsHtmlArtifactPopupOpen
} from '../HtmlArtifactPopupContext'

vi.mock('../HtmlArtifactView', () => ({
  HtmlArtifactPopupOutlet: () => null
}))

function ArtifactProbe({ artifactId }: { artifactId: string }) {
  const approvedHtml = useApprovedInteractiveHtml(artifactId)
  const isPopupOpen = useIsHtmlArtifactPopupOpen(artifactId)

  return (
    <div>
      <output aria-label={`${artifactId} approval`}>{approvedHtml ?? 'none'}</output>
      <output aria-label={`${artifactId} popup`}>{String(isPopupOpen)}</output>
    </div>
  )
}

function PopupProbe() {
  const popupSession = useHtmlArtifactPopupSession()

  return (
    <div>
      <output aria-label="popup artifact">{popupSession?.artifactId ?? 'none'}</output>
      <output aria-label="popup title">{popupSession?.title ?? 'none'}</output>
      <output aria-label="popup html">{popupSession?.html ?? 'none'}</output>
    </div>
  )
}

function Controls() {
  const actions = useHtmlArtifactPopupActions()

  const open = (artifactId: string, title = artifactId) =>
    actions.openPopup({ artifactId, html: `<p>${artifactId}</p>`, title, editable: false, kind: 'document', zoom: 100 })

  return (
    <div>
      <button type="button" onClick={() => actions.approveInteractiveHtml('a', '<script>a()</script>')}>
        approve a
      </button>
      <button type="button" onClick={() => open('a')}>
        open a
      </button>
      <button type="button" onClick={() => open('b')}>
        open b
      </button>
      <button
        type="button"
        onClick={() =>
          actions.syncPopup({
            artifactId: 'a',
            html: '<p>a updated</p>',
            title: 'updated',
            editable: false,
            kind: 'document'
          })
        }>
        sync a
      </button>
      <button type="button" onClick={actions.closePopup}>
        close
      </button>
    </div>
  )
}

describe('HtmlArtifactPopupHost', () => {
  it('keeps approval and popup state isolated by artifact', async () => {
    render(
      <HtmlArtifactPopupHost>
        <Controls />
        <ArtifactProbe artifactId="a" />
        <ArtifactProbe artifactId="b" />
        <PopupProbe />
      </HtmlArtifactPopupHost>
    )

    expect(screen.getByRole('status', { name: 'a approval' })).toHaveTextContent('none')
    expect(screen.getByRole('status', { name: 'b approval' })).toHaveTextContent('none')
    expect(screen.getByRole('status', { name: 'popup artifact' })).toHaveTextContent('none')

    fireEvent.click(screen.getByRole('button', { name: 'approve a' }))
    expect(screen.getByRole('status', { name: 'a approval' })).toHaveTextContent('<script>a()</script>')
    expect(screen.getByRole('status', { name: 'b approval' })).toHaveTextContent('none')

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'open a' })))
    expect(screen.getByRole('status', { name: 'a popup' })).toHaveTextContent('true')
    expect(screen.getByRole('status', { name: 'b popup' })).toHaveTextContent('false')
    expect(screen.getByRole('status', { name: 'popup artifact' })).toHaveTextContent('a')

    fireEvent.click(screen.getByRole('button', { name: 'sync a' }))
    expect(screen.getByRole('status', { name: 'popup title' })).toHaveTextContent('updated')
    expect(screen.getByRole('status', { name: 'popup html' })).toHaveTextContent('<p>a updated</p>')

    fireEvent.click(screen.getByRole('button', { name: 'open b' }))
    expect(screen.getByRole('status', { name: 'a popup' })).toHaveTextContent('false')
    expect(screen.getByRole('status', { name: 'b popup' })).toHaveTextContent('true')
    expect(screen.getByRole('status', { name: 'popup artifact' })).toHaveTextContent('b')

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.getByRole('status', { name: 'a popup' })).toHaveTextContent('false')
    expect(screen.getByRole('status', { name: 'b popup' })).toHaveTextContent('false')
    expect(screen.getByRole('status', { name: 'popup artifact' })).toHaveTextContent('none')
  })
})
