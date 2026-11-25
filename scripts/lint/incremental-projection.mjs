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
          missing: 'Configured live writer {{name}} was not found in this file.',
          wide: 'The live writer receives an addressed edit. Move whole-source reads to baseline or recovery.'
        }
      },
      create(context) {
        const methods = new Set(context.options[0])
        const defined = new Set()
        const calls = new Map()
        const reads = []
        function functionName(node) {
          if (node.type === 'MethodDefinition') return key(node.key)
          if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') return node.id?.name
          if (
            node.type === 'ArrowFunctionExpression' &&
            node.parent?.type === 'VariableDeclarator' &&
            ['Program', 'ExportNamedDeclaration'].includes(node.parent.parent?.parent?.type)
          )
            return node.parent.id?.name
        }
        function enclosing(node) {
          for (let p = node.parent; p; p = p.parent) {
            const name = functionName(p)
            if (name) return name
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
          'MethodDefinition, FunctionDeclaration, FunctionExpression, ArrowFunctionExpression'(node) {
            const name = functionName(node)
            if (name) defined.add(name)
          },
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
          'Program:exit'(node) {
            for (const name of methods)
              if (!defined.has(name)) context.report({ node, messageId: 'missing', data: { name } })
            const reachable = new Set(methods)
            for (const name of reachable) for (const next of calls.get(name) ?? []) reachable.add(next)
            for (const { owner, node } of reads) if (reachable.has(owner)) context.report({ node, messageId: 'wide' })
          }
        }
      }
    }
  }
}
