import { parseSync } from '@swc/core'
import { describe, expect, it } from 'vitest'

import { emptyRegistry, reconcileRegistry } from '../registry'
import { mergeDataUi, mergeUiProps } from '../runtime'
import { uiContractForDescriptor } from '../semanticId'
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

  it('preserves a registered ID when a file moves', () => {
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

  it('emits parseable JSX for self-closing intrinsic elements', () => {
    const result = transformJsx('const Message = () => <div><span /></div>', {
      ...options,
      contractForDescriptor: uiContractForDescriptor
    })

    expect(result.code).toContain('<span data-ui=')
    expect(result.code).toContain(' />')
    expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
  })

  it('uses file-relative SWC spans across files with leading comments and multibyte text', () => {
    transformJsx('const Previous = () => <aside />', options)
    const source = `// 原始路径：组件 — editable
const Message = () => {
  const handleClick = (event: Event) => event.preventDefault()
  return <div onClick={handleClick}><span /></div>
}`
    const result = transformJsx(source, {
      ...options,
      contractForDescriptor: uiContractForDescriptor
    })

    expect(result.descriptors[0].sourceOffset).toBe(source.indexOf('<div'))
    expect(result.code).toContain('event.preventDefault()')
    expect(result.code).toContain('<div data-ui=')
    expect(result.code).toContain('<span data-ui=')
    expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
  })

  it('adds the exact ID to runtime uiTokens without losing dynamic scope', () => {
    const result = transformJsx(
      "const Message = ({ id }) => <div data-ui={uiTokens('chat.message', { scopes: [`message:${id}`] })} />",
      {
        ...options,
        contractForDescriptor: () => ({ id: 'ui-abcdef0123456789', semanticId: 'chat.message' })
      }
    )

    expect(result.code).toContain("uiTokens('chat.message', { scopes: [`message:${id}`] })")
    expect(result.code).toContain('id:ui-abcdef0123456789')
  })

  it('assigns exact IDs only to intrinsic DOM and composes forwarded component tokens', () => {
    const callSite = transformJsx(
      "const App = () => <MessageWrapper data-ui={uiTokens('chat.message', { scopes: ['message:m_817'] })} />",
      {
        ...options,
        contractForDescriptor: () => ({ id: 'ui-1111111111111111', semanticId: 'chat.message' })
      }
    )
    const implementation = transformJsx('const MessageWrapper = (props) => <div data-ui="part:wrapper" {...props} />', {
      ...options,
      contractForDescriptor: () => ({ id: 'ui-2222222222222222', semanticId: 'chat.wrapper' })
    })

    expect(callSite.descriptors).toHaveLength(0)
    expect(callSite.code).not.toContain('id:ui-1111111111111111')
    expect(implementation.descriptors).toHaveLength(1)
    expect(implementation.code).toContain('__cherryUiContractMergeUiProps(props')
    expect(implementation.code).toContain('part:wrapper id:ui-2222222222222222')
    expect(
      mergeDataUi('chat.wrapper part:wrapper id:ui-2222222222222222', 'chat.message scope:message:m_817 id:ignored')
    ).toBe('chat.message part:wrapper id:ui-2222222222222222 scope:message:m_817')
    expect(
      mergeUiProps(
        { 'data-ui': 'chat.message scope:message:m_817' },
        'chat.wrapper part:wrapper id:ui-2222222222222222'
      )
    ).toEqual({
      'data-ui': 'chat.message part:wrapper id:ui-2222222222222222 scope:message:m_817'
    })
  })

  it('composes data-ui regardless of whether a props spread appears before or after the authored part', () => {
    for (const source of [
      'const Wrapper = (props) => <div data-ui="part:wrapper" {...props} />',
      'const Wrapper = (props) => <div {...props} data-ui="part:wrapper" />'
    ]) {
      const result = transformJsx(source, {
        ...options,
        contractForDescriptor: () => ({ id: 'ui-2222222222222222', semanticId: 'chat.wrapper' })
      })

      expect(result.code.indexOf('data-ui=')).toBeLessThan(result.code.indexOf('{...__cherryUiContractMergeUiProps'))
      expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
    }
  })

  it('adds a transparent data-ui merge layer around asChild content', () => {
    const result = transformJsx('const App = () => <Button asChild><a href="/settings" /></Button>', {
      ...options,
      contractForDescriptor: () => ({ id: 'ui-3333333333333333', semanticId: 'settings.action.open' })
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
        id: 'ui-abcdef0123456789',
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
        contractForDescriptor: uiContractForDescriptor
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
        contractForDescriptor: uiContractForDescriptor
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

  it('mirrors a packages/ui data-slot into data-ui while preserving the library marker', () => {
    const result = transformJsx('const Button = (props) => <button data-slot="button" {...props} />', {
      contractForDescriptor: () => ({ id: 'ui-2222222222222222', semanticId: 'ui.button' }),
      sourceFile: 'packages/ui/src/components/primitives/button.tsx'
    })

    expect(result.descriptors).toHaveLength(1)
    expect(result.code).toContain('data-ui="ui.button part:button id:ui-2222222222222222"')
    expect(result.code).toContain('data-slot="button"')
    expect(result.code).toContain('__cherryUiContractMergeUiProps(props')
    expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
  })

  it('forwards a packages/ui data-slot through a component boundary as a part token', () => {
    const result = transformJsx(
      'const Trigger = (props) => <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />',
      {
        contractForDescriptor: () => undefined,
        sourceFile: 'packages/ui/src/components/primitives/dialog.tsx'
      }
    )

    expect(result.descriptors).toHaveLength(0)
    expect(result.code).toContain('data-ui="part:dialog-trigger"')
    expect(result.code).toContain('data-slot="dialog-trigger"')
    expect(result.code).toContain('__cherryUiContractMergeUiProps(props')
  })

  it('rejects data-slot outside packages/ui', () => {
    expect(() => transformJsx('const Button = () => <button data-slot="save" />', options)).toThrow(
      'data-slot is reserved for packages/ui/src'
    )
  })

  it('rejects dynamic packages/ui data-slot values', () => {
    expect(() =>
      transformJsx('const Button = ({ slot }) => <button data-slot={slot} />', {
        sourceFile: 'packages/ui/src/components/primitives/button.tsx'
      })
    ).toThrow('packages/ui data-slot must be a static token')
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
      contractForDescriptor: uiContractForDescriptor,
      sourceFile: 'src/renderer/windows/main/index.html',
      windowName: 'main'
    })

    expect(result.descriptors).toHaveLength(2)
    expect(result.code).toContain('scope:window:main')
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
        contractForDescriptor: uiContractForDescriptor,
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
