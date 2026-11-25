const key = (node) => node?.name ?? node?.value

const wholeSource = new Set([
  'snapshot',
  'messageIds',
  'readMessage',
  'replyEntries',
  'materialize',
  'forEachPart',
  'readParts',
  'projectLiveMessageParts',
  'materializeParts',
  'reconcilePreview',
  'messageObservation',
  'applyMessageParts'
])

export default {
  meta: { name: 'incremental-projection' },
  rules: {
    'addressed-writes': {
      meta: {
        type: 'problem',
        schema: [{ type: 'array', items: { type: 'string' } }],
        messages: {
          wide: 'The live writer receives an addressed edit. Move whole-source reads to baseline or recovery.'
        }
      },
      create(context) {
        const methods = new Set(context.options[0])
        const calls = new Map()
        const reads = []
        function enclosing(node) {
          for (let p = node.parent; p; p = p.parent) {
            if (p.type === 'MethodDefinition') return key(p.key)
            if (p.type === 'FunctionDeclaration') return p.id?.name
          }
        }
        function record(node, name) {
          const owner = enclosing(node)
          if (!owner) return
          if (
            wholeSource.has(name) ||
            (name === 'message' && node.parent?.type === 'CallExpression' && node.parent.callee === node) ||
            (name === 'publish' && key(node.object?.property) === 'feed')
          )
            reads.push({ owner, node })
        }
        return {
          MemberExpression(node) {
            if (!node.computed || node.property.type === 'Literal') record(node, key(node.property))
          },
          CallExpression(node) {
            const target = node.callee
            const owner = enclosing(node)
            const name =
              target.type === 'Identifier'
                ? target.name
                : target.type === 'MemberExpression' && target.object.type === 'ThisExpression'
                  ? key(target.property)
                  : undefined
            if (target.type === 'Identifier') record(target, target.name)
            if (!name || !owner) return
            if (!calls.has(owner)) calls.set(owner, new Set())
            calls.get(owner).add(name)
          },
          'Program:exit'() {
            const reachable = new Set(methods)
            for (const name of reachable) for (const next of calls.get(name) ?? []) reachable.add(next)
            for (const { owner, node } of reads) if (reachable.has(owner)) context.report({ node, messageId: 'wide' })
          }
        }
      }
    }
  }
}
