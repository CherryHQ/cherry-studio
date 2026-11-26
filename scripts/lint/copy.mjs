const globalObjects = new Set(['globalThis', 'window', 'self', 'global'])
const wrappers = new Set([
  'ChainExpression',
  'TSAsExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
  'TSSatisfiesExpression'
])

function expression(node) {
  while (node && wrappers.has(node.type)) node = node.expression
  return node
}

function propertyName(member) {
  if (member.type !== 'MemberExpression') return undefined
  return member.computed ? member.property.value : member.property.name
}

function isGlobal(identifier, source) {
  if (identifier.type !== 'Identifier') return false
  for (let scope = source.getScope(identifier); scope; scope = scope.upper) {
    const binding = scope.set.get(identifier.name)
    if (binding) return binding.defs.length === 0
  }
  return true
}

function isJsonMethod(callee, name, source) {
  if (propertyName(callee) !== name) return false
  const receiver = expression(callee.object)
  if (receiver.name === 'JSON') return isGlobal(receiver, source)
  return (
    propertyName(receiver) === 'JSON' && globalObjects.has(receiver.object.name) && isGlobal(receiver.object, source)
  )
}

function hasTransform(argument, source) {
  if (!argument || (argument.type === 'Literal' && argument.value === null)) return false
  return !(argument.name === 'undefined' && isGlobal(argument, source))
}

export default {
  meta: { name: 'copy' },
  rules: {
    'no-json-roundtrip': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          roundtrip:
            'JSON round trips serialize and allocate the entire value. Share immutable data or copy only the fields the consumer owns.'
        }
      },
      create({ sourceCode, report }) {
        return {
          CallExpression(node) {
            if (propertyName(node.callee) !== 'parse') return
            const [input, reviver] = node.arguments
            const encoded = expression(input)
            if (encoded?.type !== 'CallExpression' || !isJsonMethod(encoded.callee, 'stringify', sourceCode)) return
            if (!encoded.arguments.length || encoded.arguments[0].type === 'SpreadElement') return
            if (
              isJsonMethod(node.callee, 'parse', sourceCode) &&
              !hasTransform(reviver, sourceCode) &&
              !hasTransform(encoded.arguments[1], sourceCode)
            ) {
              report({ node, messageId: 'roundtrip' })
            }
          }
        }
      }
    }
  }
}
