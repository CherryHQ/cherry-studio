import { parseSync } from '@swc/core'
import { describe, expect, it } from 'vitest'

import { mergeDataUi, mergeUiProps } from '../runtime'
import { transformHtml, transformJsx } from '../transform'

const options = { sourceFile: 'src/renderer/components/chat/Message.tsx' }

describe('UI contract compiler', () => {
  it('keeps inferred semantics stable across formatting-only builds', () => {
    const compact = transformJsx(
      'export function Message(){return <button onClick={handleCopy}>复制</button>}',
      options
    )
    const formatted = transformJsx(
      'export function Message() {\n  return <button onClick={handleCopy}>Copy</button>\n}',
      options
    )

    expect(compact.descriptors[0].semanticId).toBe(formatted.descriptors[0].semanticId)
  })

  it('never derives semantics from translated display text', () => {
    const chinese = transformJsx('const Message = () => <button>复制</button>', options)
    const english = transformJsx('const Message = () => <button>Copy</button>', options)

    expect(chinese.descriptors[0].semanticId).toBe(english.descriptors[0].semanticId)
  })

  it('emits parseable JSX for self-closing intrinsic elements', () => {
    const result = transformJsx('const Message = () => <input />', {
      ...options,
      injectDataUi: true
    })

    expect(result.code).toContain('<input data-ui=')
    expect(result.code).toContain(' />')
    expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
  })

  it('marks component roots without labeling adjacent internal elements', () => {
    const result = transformJsx(
      'const Message = () => <article><header /><div><p>Body</p><span>Meta</span></div><footer /></article>',
      {
        ...options,
        injectDataUi: true
      }
    )

    expect(result.descriptors.map((descriptor) => descriptor.semanticId)).toEqual(['chat.message'])
    expect(result.code).toContain('<article data-ui="chat.message">')
    expect(result.code).toContain('<header />')
    expect(result.code).toContain('<p>Body</p>')
    expect(result.code).not.toContain('<header data-ui=')
    expect(result.code).not.toContain('<p data-ui=')
  })

  it('promotes named business actions but ignores event-plumbing handlers', () => {
    const result = transformJsx(
      `const Message = () => (
        <div>
          <button onClick={handleCopy} onKeyDown={handleKeyDown}>Copy</button>
          <button onClick={handleClick}>Open</button>
          <div onClick={(event) => event.stopPropagation()} />
        </div>
      )`,
      {
        ...options,
        injectDataUi: true
      }
    )

    expect(result.descriptors.map((descriptor) => descriptor.semanticId)).toEqual([
      'chat.message',
      'chat.message.action.copy'
    ])
    expect(result.code).not.toContain('action.click')
    expect(result.code).not.toContain('action.stop')
  })

  it('uses compact component ownership instead of implementation path fragments', () => {
    const sortable = transformJsx('const SortableItemRenderer = () => <div />', {
      sourceFile: 'src/renderer/components/VirtualList/SortableItemRenderer.tsx'
    })
    const markdown = transformJsx('const useChatMarkdownComponents = () => <p />', {
      sourceFile: 'src/renderer/components/chat/messages/markdown/useChatMarkdownComponents.tsx'
    })

    expect(sortable.descriptors[0].semanticId).toBe('ui.sortable-item')
    expect(markdown.descriptors[0].semanticId).toBe('chat.markdown')
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
      injectDataUi: true
    })

    expect(result.descriptors[0].sourceOffset).toBe(source.indexOf('<div'))
    expect(result.code).toContain('event.preventDefault()')
    expect(result.code).toContain('<div data-ui=')
    expect(result.code).toContain('<span />')
    expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
  })

  it('composes forwarded component semantics onto intrinsic DOM', () => {
    const callSite = transformJsx('const App = () => <MessageWrapper data-ui="chat.message" />', {
      ...options,
      injectDataUi: true
    })
    const implementation = transformJsx('const MessageWrapper = (props) => <div data-ui="part:wrapper" {...props} />', {
      ...options,
      injectDataUi: true
    })

    expect(callSite.descriptors.map((descriptor) => descriptor.semanticId)).toEqual(['chat.message'])
    expect(implementation.descriptors).toHaveLength(1)
    expect(implementation.code).toContain('__cherryUiContractMergeUiProps(props')
    expect(implementation.code).toContain('part:wrapper')
    expect(mergeDataUi('chat.wrapper part:wrapper', 'chat.message')).toBe('chat.message part:wrapper')
    expect(mergeUiProps({ 'data-ui': 'chat.message' }, 'chat.wrapper part:wrapper')).toEqual({
      'data-ui': 'chat.message part:wrapper'
    })
  })

  it('composes data-ui regardless of whether a props spread appears before or after the authored part', () => {
    for (const source of [
      'const Wrapper = (props) => <div data-ui="part:wrapper" {...props} />',
      'const Wrapper = (props) => <div {...props} data-ui="part:wrapper" />'
    ]) {
      const result = transformJsx(source, {
        ...options,
        injectDataUi: true
      })

      expect(result.code.indexOf('data-ui=')).toBeLessThan(result.code.indexOf('{...__cherryUiContractMergeUiProps'))
      expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
    }
  })

  it('adds a transparent data-ui merge layer when asChild is statically true', () => {
    for (const asChild of ['asChild', 'asChild={true}']) {
      const result = transformJsx(`const App = () => <Button ${asChild}><a href="/settings" /></Button>`, {
        ...options,
        injectDataUi: true
      })

      expect(result.descriptors).toHaveLength(0)
      expect(result.code).toContain('<__CherryUiContractSlot><a href="/settings" />')
      expect(result.code).toContain('</__CherryUiContractSlot></Button>')
      expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
    }
  })

  it('does not add a data-ui merge layer when asChild is statically false', () => {
    const result = transformJsx(
      'const App = () => <Button asChild={false}><a href="/settings" /><span>Label</span></Button>',
      {
        ...options,
        injectDataUi: true
      }
    )

    expect(result.descriptors).toHaveLength(0)
    expect(result.code).not.toContain('__CherryUiContractSlot')
    expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
  })

  it('keeps the data-ui merge layer when asChild is dynamic', () => {
    const result = transformJsx('const App = () => <Button asChild={useSlot}><a href="/settings" /></Button>', {
      ...options,
      injectDataUi: true
    })

    expect(result.descriptors).toHaveLength(0)
    expect(result.code).toContain('<__CherryUiContractSlot><a href="/settings" />')
    expect(result.code).toContain('</__CherryUiContractSlot></Button>')
    expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
  })

  it('treats component call sites as parent boundaries for ordinary children', () => {
    const result = transformJsx('const Message = () => <Card><span /></Card>', {
      ...options,
      injectDataUi: true
    })

    expect(result.descriptors).toHaveLength(0)
    expect(result.code).toContain('<Card>')
    expect(result.code).toContain('<span />')
  })

  it('annotates SVG roots but skips internal drawing nodes by default', () => {
    const result = transformJsx(
      'const Icon = () => <svg><defs><linearGradient><stop /></linearGradient></defs><path /><circle /></svg>',
      {
        ...options,
        injectDataUi: true
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
        injectDataUi: true
      }
    )

    expect(result.descriptors.map((descriptor) => descriptor.element)).toEqual(['svg', 'path', 'circle', 'div'])
    expect(result.code).toContain('<path data-ui="')
    expect(result.code).toContain('part:accent')
    expect(result.code).toContain('<rect onClick={handleClick} />')
    expect(result.code).toContain('<g />')
    expect(result.code).not.toContain('<g data-ui=')
    expect(result.code).toContain('<div data-ui=')
  })

  it('derives a structural part from data-slot while preserving the marker', () => {
    const result = transformJsx('const Button = (props) => <button data-slot="button" {...props} />', {
      injectDataUi: true,
      sourceFile: 'src/renderer/components/Button.tsx'
    })

    expect(result.descriptors).toHaveLength(1)
    expect(result.code).toContain('part:button')
    expect(result.code).not.toContain('id:ui-')
    expect(result.code).toContain('data-slot="button"')
    expect(result.code).toContain('__cherryUiContractMergeUiProps(props')
    expect(() => parseSync(result.code, { syntax: 'typescript', tsx: true })).not.toThrow()
  })

  it('normalizes data-slot and authored part tokens into the same inferred semantic', () => {
    const dataSlot = transformJsx('const Panel = () => <section data-slot="panel" />', options)
    const authoredPart = transformJsx('const Panel = () => <section data-ui="part:panel" />', options)

    expect(dataSlot.descriptors[0].semanticId).toBe(authoredPart.descriptors[0].semanticId)
  })

  it('forwards an existing data-slot through a component boundary as a part token', () => {
    const result = transformJsx(
      'const Trigger = (props) => <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />',
      {
        injectDataUi: true,
        sourceFile: 'src/renderer/components/Dialog.tsx'
      }
    )

    // The call site carries no semantic id of its own, but its forwarded part
    // is a contract point scan/query must see.
    expect(result.descriptors).toHaveLength(1)
    expect(result.descriptors[0].semanticId).toBe('')
    expect(result.descriptors[0].parts).toEqual(['dialog-trigger'])
    expect(result.code).toContain('data-ui="part:dialog-trigger"')
    expect(result.code).toContain('data-slot="dialog-trigger"')
    expect(result.code).toContain('__cherryUiContractMergeUiProps(props')
  })

  it('rejects dynamic data-slot values', () => {
    expect(() => transformJsx('const Button = ({ slot }) => <button data-slot={slot} />', options)).toThrow(
      'data-slot must be a static token'
    )
  })

  it('rejects authored semantic tokens the consumer grammar would refuse', () => {
    expect(() => transformJsx('const Message = () => <div data-ui="Chat.Message" />', options)).toThrow(
      'Invalid data-ui semantic token: Chat.Message'
    )
    expect(() => transformHtml('<body data-ui="App.Window"></body>', { ...options, windowName: 'main' })).toThrow(
      'Invalid data-ui semantic token: App.Window'
    )
  })

  it('rejects authored tokens in unknown namespaces instead of dropping them', () => {
    expect(() => transformJsx('const Message = () => <div data-ui="chat.foo state:active" />', options)).toThrow(
      'Unknown data-ui token namespace: state:active'
    )
  })

  it('fails instead of reporting a descriptor when an HTML data-ui attribute cannot be rewritten', () => {
    expect(() =>
      transformHtml('<body data-ui></body>', { ...options, injectDataUi: true, windowName: 'main' })
    ).toThrow('Failed to rewrite data-ui attribute on <body>')
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
      injectDataUi: true,
      sourceFile: 'src/renderer/windows/main/index.html',
      windowName: 'main'
    })

    expect(result.descriptors).toHaveLength(2)
    expect(result.code).toContain('<body data-ui="app.window">')
    expect(result.code).toContain('const sample = "<span>"')
  })

  it('derives an HTML structural part from data-slot while preserving the marker', () => {
    const result = transformHtml('<body><div data-slot="app-root"></div></body>', {
      ...options,
      injectDataUi: true,
      sourceFile: 'src/renderer/windows/main/index.html',
      windowName: 'main'
    })

    expect(result.code).toContain('data-slot="app-root"')
    expect(result.code).toContain('part:app-root')
  })

  it('keeps ordinary internal HTML under the nearest root boundary', () => {
    const result = transformHtml('<body><div></div><p></p></body>', {
      ...options,
      sourceFile: 'src/renderer/windows/main/index.html',
      windowName: 'main'
    })

    expect(result.descriptors.map((descriptor) => descriptor.element)).toEqual(['body'])
  })

  it('applies the same SVG coverage policy to window HTML', () => {
    const result = transformHtml(
      '<body><svg><defs><path /></defs><circle data-testid="status-dot" /><foreignObject><div /></foreignObject></svg></body>',
      {
        ...options,
        injectDataUi: true,
        sourceFile: 'src/renderer/windows/main/index.html',
        windowName: 'main'
      }
    )

    expect(result.descriptors.map((descriptor) => descriptor.element)).toEqual(['body', 'circle', 'div'])
    expect(result.code).not.toContain('<svg data-ui=')
    expect(result.code).not.toContain('<path data-ui=')
    expect(result.code).toContain('<circle data-testid="status-dot" data-ui=')
    expect(result.code).toContain('<div data-ui=')
  })
})
