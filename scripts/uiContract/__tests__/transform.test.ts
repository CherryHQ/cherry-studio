import { parseSync } from '@swc/core'
import { describe, expect, it } from 'vitest'

import { emptyRegistry, reconcileRegistry } from '../registry'
import { mergeDataUi, mergeUiProps } from '../runtime'
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
    const original = transformJsx('const CopyButton = () => <button data-ui="part:copy-button" />', options)
    const first = reconcileRegistry(emptyRegistry(), original.descriptors)
    const moved = transformJsx('const CopyButton = () => <button data-ui="part:copy-button" />', {
      ...options,
      sourceFile: 'src/renderer/components/actions/CopyButton.tsx'
    })
    moved.descriptors[0].previousAnchorHash = original.descriptors[0].anchorHash
    const second = reconcileRegistry(first, moved.descriptors)

    expect(second.nodes[0][2]).toBe(first.nodes[0][2])
  })

  it('retires an ID instead of reusing it for an unrelated structural match', () => {
    const original = transformJsx('const Panel = () => <section data-ui="account.panel" />', {
      ...options,
      sourceFile: 'src/renderer/pages/account/Panel.tsx'
    })
    const first = reconcileRegistry(emptyRegistry(), original.descriptors)
    const replacement = transformJsx('const Panel = () => <section data-ui="billing.panel" />', {
      ...options,
      sourceFile: 'src/renderer/pages/billing/Panel.tsx'
    })
    const second = reconcileRegistry(first, replacement.descriptors)

    expect(replacement.descriptors[0].fingerprintHash).toBe(original.descriptors[0].fingerprintHash)
    expect(second.nodes[0][2]).not.toBe(first.nodes[0][2])
    expect(second.retiredIds).toContain(first.nodes[0][2])
  })

  it('emits parseable JSX for self-closing intrinsic elements', () => {
    const result = transformJsx('const Message = () => <div><span /></div>', {
      ...options,
      contractForDescriptor: (descriptor) => ({
        id: `u${descriptor.anchorHash.slice(0, 7)}`,
        semanticId: descriptor.semanticId
      })
    })

    expect(result.code).toContain('<span data-ui=')
    expect(result.code).toContain(' />')
    expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
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

  it('assigns exact IDs only to intrinsic DOM and composes forwarded component tokens', () => {
    const callSite = transformJsx(
      "const App = () => <MessageWrapper data-ui={uiTokens('chat.message', { states: ['selected'] })} />",
      {
        ...options,
        contractForDescriptor: () => ({ id: 'ucallsite', semanticId: 'chat.message' })
      }
    )
    const implementation = transformJsx('const MessageWrapper = (props) => <div data-ui="part:wrapper" {...props} />', {
      ...options,
      contractForDescriptor: () => ({ id: 'udomnode', semanticId: 'chat.wrapper' })
    })

    expect(callSite.descriptors).toHaveLength(0)
    expect(callSite.code).not.toContain('id:ucallsite')
    expect(implementation.descriptors).toHaveLength(1)
    expect(implementation.code).toContain('__cherryUiContractMergeUiProps(props')
    expect(implementation.code).toContain('part:wrapper id:udomnode')
    expect(mergeDataUi('chat.wrapper part:wrapper id:udomnode', 'chat.message state:selected id:ignored')).toBe(
      'chat.message part:wrapper id:udomnode state:selected'
    )
    expect(mergeUiProps({ 'data-ui': 'chat.message state:selected' }, 'chat.wrapper part:wrapper id:udomnode')).toEqual(
      {
        'data-ui': 'chat.message part:wrapper id:udomnode state:selected'
      }
    )
  })

  it('composes data-ui regardless of whether a props spread appears before or after the authored part', () => {
    for (const source of [
      'const Wrapper = (props) => <div data-ui="part:wrapper" {...props} />',
      'const Wrapper = (props) => <div {...props} data-ui="part:wrapper" />'
    ]) {
      const result = transformJsx(source, {
        ...options,
        contractForDescriptor: () => ({ id: 'udomnode', semanticId: 'chat.wrapper' })
      })

      expect(result.code.indexOf('data-ui=')).toBeLessThan(result.code.indexOf('{...__cherryUiContractMergeUiProps'))
      expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
    }
  })

  it('adds a transparent data-ui merge layer around asChild content', () => {
    const result = transformJsx('const App = () => <Button asChild><a href="/settings" /></Button>', {
      ...options,
      contractForDescriptor: () => ({ id: 'ulink', semanticId: 'settings.action.open' })
    })

    expect(result.descriptors.map((descriptor) => descriptor.element)).toEqual(['a'])
    expect(result.code).toContain('<__CherryUiContractSlot><a data-ui=')
    expect(result.code).toContain('</__CherryUiContractSlot></Button>')
    expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
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

  it('annotates SVG roots but skips internal drawing nodes by default', () => {
    const result = transformJsx(
      'const Icon = () => <svg><defs><linearGradient><stop /></linearGradient></defs><path /><circle /></svg>',
      {
        ...options,
        contractForDescriptor: (descriptor) => ({
          id: `u${descriptor.anchorHash.slice(0, 7)}`,
          semanticId: descriptor.semanticId
        })
      }
    )

    expect(result.descriptors.map((descriptor) => descriptor.element)).toEqual(['svg'])
    expect(result.code).toContain('<svg data-ui=')
    expect(result.code).toContain('<path />')
    expect(result.code).not.toContain('<path data-ui=')
  })

  it('keeps explicitly marked SVG internals and foreignObject HTML in the contract', () => {
    const result = transformJsx(
      `const Icon = () => (
        <svg>
          <path data-ui="part:accent" />
          <circle data-testid="status-dot" />
          <rect onClick={handleClick} />
          <g />
          <foreignObject><div><span /></div></foreignObject>
        </svg>
      )`,
      {
        ...options,
        contractForDescriptor: (descriptor) => ({
          id: `u${descriptor.anchorHash.slice(0, 7)}`,
          semanticId: descriptor.semanticId
        })
      }
    )

    expect(result.descriptors.map((descriptor) => descriptor.element)).toEqual([
      'svg',
      'path',
      'circle',
      'rect',
      'div',
      'span'
    ])
    expect(result.code).toContain('<path data-ui="')
    expect(result.code).toContain('part:accent id:')
    expect(result.code).toContain('<g />')
    expect(result.code).not.toContain('<g data-ui=')
    expect(result.code).toContain('<div data-ui=')
  })

  it('rejects the obsolete data-slot attribute', () => {
    expect(() => transformJsx('const Button = () => <button data-slot="save" />', options)).toThrow(
      'data-slot is obsolete'
    )
  })

  it('does not register component boundaries that cannot render DOM', () => {
    const result = transformJsx(
      'const Dialog = () => <DialogPrimitive.Root data-ui="part:dialog"><DialogPrimitive.Portal data-ui="part:dialog-portal" /></DialogPrimitive.Root>',
      options
    )

    expect(result.descriptors).toHaveLength(0)
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
    expect(result.code).toContain('scope:window:main')
    expect(result.code).not.toContain('boundary:app')
    expect(result.code).toContain('const sample = "<span>"')
  })

  it('anchors HTML siblings to their actual parent instead of the previous opening tag', () => {
    const base = transformHtml('<body><div></div><p></p></body>', {
      ...options,
      sourceFile: 'src/renderer/windows/main/index.html',
      windowName: 'main'
    })
    const nested = transformHtml('<body><div><span></span></div><p></p></body>', {
      ...options,
      sourceFile: 'src/renderer/windows/main/index.html',
      windowName: 'main'
    })

    expect(base.descriptors.find((descriptor) => descriptor.element === 'p')?.anchorHash).toBe(
      nested.descriptors.find((descriptor) => descriptor.element === 'p')?.anchorHash
    )
  })

  it('applies the same SVG coverage policy to window HTML', () => {
    const result = transformHtml(
      '<body><svg><defs><path /></defs><circle data-testid="status-dot" /><foreignObject><div /></foreignObject></svg></body>',
      {
        ...options,
        contractForDescriptor: (descriptor) => ({
          id: `u${descriptor.anchorHash.slice(0, 7)}`,
          semanticId: descriptor.semanticId
        }),
        sourceFile: 'src/renderer/windows/main/index.html',
        windowName: 'main'
      }
    )

    expect(result.descriptors.map((descriptor) => descriptor.element)).toEqual(['body', 'svg', 'circle', 'div'])
    expect(result.code).not.toContain('<path data-ui=')
    expect(result.code).toContain('<circle data-testid="status-dot" data-ui=')
    expect(result.code).toContain('<div data-ui=')
  })
})
