import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PlantUmlPreview from '../PlantUmlPreview'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('PlantUmlPreview', () => {
  const content = '@startuml\nA -> B\n@enduml'
  const nextContent = '@startuml\nA -> C\n@enduml'
  let requests: ReturnType<typeof deferred<Response>>[]

  beforeEach(() => {
    vi.useFakeTimers()
    requests = []
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        const request = deferred<Response>()
        requests.push(request)
        return request.promise
      })
    )
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function startRequest() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
  }

  async function completeRequest(index: number, label: string) {
    await act(async () => {
      requests[index].resolve(new Response(`<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>`))
    })
  }

  function previewHost(container: HTMLElement) {
    return container.querySelector<HTMLDivElement>('.plantuml-preview')!
  }

  it('shows the fetched diagram', async () => {
    const { container } = render(<PlantUmlPreview>{content}</PlantUmlPreview>)
    await startRequest()
    await completeRequest(0, 'current diagram')

    expect(previewHost(container).shadowRoot?.textContent).toContain('current diagram')
  })

  it.each(['response', 'body'])('keeps the newer diagram when an obsolete %s finishes last', async (stage) => {
    const { container, rerender } = render(<PlantUmlPreview>{content}</PlantUmlPreview>)
    await startRequest()
    const body = deferred<string>()
    if (stage === 'body') {
      await act(async () => {
        requests[0].resolve({ ok: true, text: () => body.promise } as Response)
      })
    }

    rerender(<PlantUmlPreview>{nextContent}</PlantUmlPreview>)
    await startRequest()
    await completeRequest(1, 'new diagram')
    expect(previewHost(container).shadowRoot?.textContent).toContain('new diagram')

    if (stage === 'body') {
      await act(async () => {
        body.resolve('<svg xmlns="http://www.w3.org/2000/svg"><text>old diagram</text></svg>')
      })
    } else {
      await completeRequest(0, 'old diagram')
    }

    expect(previewHost(container).shadowRoot?.textContent).toContain('new diagram')
    expect(previewHost(container).shadowRoot?.textContent).not.toContain('old diagram')
  })

  it('invalidates an old diagram as soon as the source changes, before the next request starts', async () => {
    const { container, rerender } = render(<PlantUmlPreview>{content}</PlantUmlPreview>)
    await startRequest()

    rerender(<PlantUmlPreview>{nextContent}</PlantUmlPreview>)
    await completeRequest(0, 'old diagram')
    expect(Boolean(previewHost(container).shadowRoot?.querySelector('svg'))).toBe(false)

    await startRequest()
    await completeRequest(1, 'new diagram')
    expect(previewHost(container).shadowRoot?.textContent).toContain('new diagram')
  })

  it('does not populate an empty preview with an obsolete diagram', async () => {
    const { container, rerender } = render(<PlantUmlPreview>{content}</PlantUmlPreview>)
    await startRequest()

    rerender(<PlantUmlPreview>{''}</PlantUmlPreview>)
    await completeRequest(0, 'old diagram')

    expect(Boolean(previewHost(container).shadowRoot?.querySelector('svg'))).toBe(false)
  })

  it('does not write a pending diagram after unmount', async () => {
    const { container, unmount } = render(<PlantUmlPreview>{content}</PlantUmlPreview>)
    await startRequest()
    const host = previewHost(container)

    unmount()
    await completeRequest(0, 'old diagram')

    expect(Boolean(host.shadowRoot?.querySelector('svg'))).toBe(false)
  })

  it.each([
    {
      status: 400,
      statusText: 'Bad Request',
      message:
        'Diagram rendering failed (400): This is likely due to a syntax error in the diagram. Please check your code.'
    },
    {
      status: 503,
      statusText: 'Service Unavailable',
      message: 'Diagram rendering failed (503): The PlantUML server is temporarily unavailable. Please try again later.'
    },
    {
      status: 418,
      statusText: "I'm a teapot",
      message: "Diagram rendering failed, server returned: 418 I'm a teapot"
    }
  ])('reports the user-facing error for a $status response', async ({ status, statusText, message }) => {
    render(<PlantUmlPreview>{content}</PlantUmlPreview>)
    await startRequest()
    await act(async () => {
      requests[0].resolve(new Response(null, { status, statusText }))
    })

    expect(screen.getByText(message)).toBeInTheDocument()
  })
})
