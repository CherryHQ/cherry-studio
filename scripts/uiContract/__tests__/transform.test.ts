import { describe, expect, it } from 'vitest'

import { emptyRegistry, reconcileRegistry } from '../registry'
import { transformHtml, transformJsx } from '../transform'

const options = { sourceFile: 'src/renderer/components/chat/Message.tsx' }

describe('UI contract compiler', () => {
  it('keeps IDs stable across formatting-only builds', () => {
    const compact = transformJsx(
      'export function Message(){return <button onClick={handleCopy}>复制</button>}',
      options
    )
    const formatted = transformJsx(
      'export function Message() {\n  return <button onClick={handleCopy}>Copy</button>\n}',
      options
    )

    expect(compact.descriptors[0].anchorHash).toBe(formatted.descriptors[0].anchorHash)
    const first = reconcileRegistry(emptyRegistry(), compact.descriptors)
    const second = reconcileRegistry(first, formatted.descriptors)
    expect(second.nodes[0][2]).toBe(first.nodes[0][2])
  })

  it('never derives semantics from translated display text', () => {
    const chinese = transformJsx('const Message = () => <button>复制</button>', options)
    const english = transformJsx('const Message = () => <button>Copy</button>', options)

    expect(chinese.descriptors[0].semanticId).toBe(english.descriptors[0].semanticId)
    expect(chinese.descriptors[0].anchorHash).toBe(english.descriptors[0].anchorHash)
  })

  it('preserves a uniquely recoverable ID when a file moves', () => {
    const original = transformJsx('const CopyButton = () => <button data-slot="copy-button" />', options)
    const first = reconcileRegistry(emptyRegistry(), original.descriptors)
    const moved = transformJsx('const CopyButton = () => <button data-slot="copy-button" />', {
      ...options,
      sourceFile: 'src/renderer/components/actions/CopyButton.tsx'
    })
    const second = reconcileRegistry(first, moved.descriptors)

    expect(second.nodes[0][2]).toBe(first.nodes[0][2])
  })

  it('adds the exact ID to runtime uiTokens without losing dynamic state', () => {
    const result = transformJsx(
      "const Message = ({ id }) => <div data-ui={uiTokens('chat.message', { scopes: [`message:${id}`] })} />",
      {
        ...options,
        contractForDescriptor: () => ({ id: 'uabcdef0', semanticId: 'chat.message' })
      }
    )

    expect(result.code).toContain("uiTokens('chat.message', { scopes: [`message:${id}`] })")
    expect(result.code).toContain('id:uabcdef0')
  })

  it('annotates intrinsic DOM but skips unmarked component call sites', () => {
    const result = transformJsx('const Message = () => <Card><span /></Card>', {
      ...options,
      contractForDescriptor: () => ({
        id: 'uabcdef0',
        semanticId: 'chat.message.element.span'
      })
    })

    expect(result.descriptors).toHaveLength(1)
    expect(result.code).toContain('<Card>')
    expect(result.code).toContain('<span data-ui=')
  })

  it('annotates HTML roots without parsing markup inside scripts', () => {
    const result = transformHtml('<body><div id="root"></div><script>const sample = "<span>"</script></body>', {
      ...options,
      contractForDescriptor: (descriptor) => ({
        id: `u${descriptor.anchorHash.slice(0, 7)}`,
        semanticId: descriptor.semanticId
      }),
      sourceFile: 'src/renderer/windows/main/index.html',
      windowName: 'main'
    })

    expect(result.descriptors).toHaveLength(2)
    expect(result.code).toContain('scope:window:main boundary:app theme:custom')
    expect(result.code).toContain('const sample = "<span>"')
  })
})
