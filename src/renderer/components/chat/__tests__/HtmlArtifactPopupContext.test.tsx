// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  HtmlArtifactPopupHost,
  useApprovedInteractiveHtml,
  useHtmlArtifactPopupActions,
  useIsHtmlArtifactPopupOpen
} from '../HtmlArtifactPopupContext'

vi.mock('../HtmlArtifactView', () => ({
  HtmlArtifactPopupOutlet: () => null
}))

function ArtifactProbe({ artifactId }: { artifactId: string }) {
  const renderCount = useRef(0)
  renderCount.current += 1
  const approvedHtml = useApprovedInteractiveHtml(artifactId)
  const isPopupOpen = useIsHtmlArtifactPopupOpen(artifactId)

  return (
    <div>
      <output aria-label={`${artifactId} renders`}>{renderCount.current}</output>
      <output aria-label={`${artifactId} approval`}>{approvedHtml ?? 'none'}</output>
      <output aria-label={`${artifactId} popup`}>{String(isPopupOpen)}</output>
    </div>
  )
}

function Controls() {
  const actions = useHtmlArtifactPopupActions()
  const renderCount = useRef(0)
  renderCount.current += 1

  const open = (artifactId: string, title = artifactId) =>
    actions.openPopup({ artifactId, html: `<p>${artifactId}</p>`, title, editable: false, kind: 'document', zoom: 100 })

  return (
    <div>
      <output aria-label="controls renders">{renderCount.current}</output>
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
  it('only re-renders artifacts whose selected approval or popup state changes', async () => {
    render(
      <HtmlArtifactPopupHost>
        <Controls />
        <ArtifactProbe artifactId="a" />
        <ArtifactProbe artifactId="b" />
      </HtmlArtifactPopupHost>
    )

    expect(screen.getByRole('status', { name: 'controls renders' })).toHaveTextContent('1')
    expect(screen.getByRole('status', { name: 'a renders' })).toHaveTextContent('1')
    expect(screen.getByRole('status', { name: 'b renders' })).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: 'approve a' }))
    expect(screen.getByRole('status', { name: 'a approval' })).toHaveTextContent('<script>a()</script>')
    expect(screen.getByRole('status', { name: 'a renders' })).toHaveTextContent('2')
    expect(screen.getByRole('status', { name: 'b renders' })).toHaveTextContent('1')

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'open a' })))
    expect(screen.getByRole('status', { name: 'a popup' })).toHaveTextContent('true')
    expect(screen.getByRole('status', { name: 'a renders' })).toHaveTextContent('3')
    expect(screen.getByRole('status', { name: 'b renders' })).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: 'sync a' }))
    expect(screen.getByRole('status', { name: 'a renders' })).toHaveTextContent('3')
    expect(screen.getByRole('status', { name: 'b renders' })).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: 'open b' }))
    expect(screen.getByRole('status', { name: 'a popup' })).toHaveTextContent('false')
    expect(screen.getByRole('status', { name: 'b popup' })).toHaveTextContent('true')
    expect(screen.getByRole('status', { name: 'a renders' })).toHaveTextContent('4')
    expect(screen.getByRole('status', { name: 'b renders' })).toHaveTextContent('2')

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.getByRole('status', { name: 'a renders' })).toHaveTextContent('4')
    expect(screen.getByRole('status', { name: 'b renders' })).toHaveTextContent('3')
    expect(screen.getByRole('status', { name: 'controls renders' })).toHaveTextContent('1')
  })
})
