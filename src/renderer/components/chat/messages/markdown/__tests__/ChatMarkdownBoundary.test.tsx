import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ChatMarkdown from '../ChatMarkdown'

vi.mock('../ChatMarkdownRuntime', () => ({
  default: () => <div data-testid="plain-runtime" />
}))

vi.mock('../ChatMarkdownMermaidRuntime', () => ({
  default: () => <div data-testid="mermaid-runtime" />
}))

vi.mock('../StandaloneHtmlArtifactRenderer', () => ({
  default: () => <div data-testid="html-artifact" />
}))

const renderContent = (content: string) => render(<ChatMarkdown block={{ id: 'part', content, status: 'success' }} />)

describe('ChatMarkdown runtime selection', () => {
  it.each([
    ['bare fence', '```mermaid\ngraph TD;\n```'],
    ['space after the marker', '``` mermaid\ngraph TD;\n```'],
    ['info metadata after the language', '```mermaid title="Flow"\ngraph TD;\n```'],
    ['tilde fence', '~~~mermaid\ngraph TD;\n~~~'],
    ['inside a block quote', '> Look:\n>\n> ```mermaid\n> graph TD;\n> ```'],
    ['inside a list item', '1. Diagram:\n\n   ```mermaid\n   graph TD;\n   ```'],
    ['after leading prose', 'Here you go:\n\n```mermaid\ngraph TD;\n```']
  ])('loads the Mermaid runtime for a fence with %s', async (_label, content) => {
    renderContent(content)
    expect(await screen.findByTestId('mermaid-runtime')).toBeInTheDocument()
  })

  it('keeps the lightweight runtime when no Mermaid fence is present', async () => {
    renderContent('```ts\nconst mermaid = 1\n```\n\nMermaid is only mentioned here.')
    expect(await screen.findByTestId('plain-runtime')).toBeInTheDocument()
  })
})
