import path from 'node:path'

const classHelpers = new Set(['cn', 'clsx', 'cx', 'classNames', 'twMerge', 'twJoin'])

function definition(context, node) {
  let scope = context.sourceCode.getScope(node)
  while (scope) {
    const variable = scope.set.get(node.name)
    if (variable) return variable.defs.length === 1 ? variable.defs[0] : undefined
    scope = scope.upper
  }
}

function resolve(context, node, seen = new Set()) {
  if (node?.type === 'JSXExpressionContainer') return resolve(context, node.expression, seen)
  if (node?.type !== 'Identifier' || seen.has(node.name)) return node
  const def = definition(context, node)
  if (def?.type !== 'Variable' || def.parent?.kind !== 'const') return node
  seen.add(node.name)
  return resolve(context, def.node.init, seen)
}

function isScrollArea(context, name) {
  const identifier = name.type === 'JSXMemberExpression' ? name.object : name
  const def = definition(context, identifier)
  if (def?.type !== 'ImportBinding') return false
  const source = def.parent.source.value
  const shared =
    /^@cherrystudio\/ui(?:\/components(?:\/primitives(?:\/scroll-area)?)?)?$/.test(source) ||
    (source.startsWith('.') &&
      path
        .resolve(path.dirname(context.filename), source)
        .replace(/\.(tsx?|jsx?)$/, '')
        .endsWith('/packages/ui/src/components/primitives/scroll-area'))
  const settings = source === '@renderer/components/SettingsPrimitives'
  if (!shared && !settings) return false
  const exportedName = settings ? 'SettingsContentColumn' : 'ScrollArea'
  return name.type === 'JSXMemberExpression'
    ? def.node.type === 'ImportNamespaceSpecifier' && name.property.name === exportedName
    : def.node.type === 'ImportSpecifier' && def.node.imported.name === exportedName
}

function paddingClass(token) {
  let depth = 0
  let start = 0
  const variants = []
  for (let index = 0; index < token.length; index++) {
    if (token[index] === '[' || token[index] === '(') depth++
    if (token[index] === ']' || token[index] === ')') depth--
    if (token[index] === ':' && depth === 0) {
      variants.push(token.slice(start, index))
      start = index + 1
    }
  }
  // Arbitrary selector variants can target descendants instead of the scroll container.
  if (variants.some((variant) => variant.startsWith('[') && !variant.startsWith('[@'))) return false
  return /^!?p(?:[xytrblse]|[bi][se]?)?-/.test(token.slice(start))
}

function classStrings(context, raw, seen = new Set()) {
  const node = resolve(context, raw)
  if (!node || seen.has(node)) return []
  seen.add(node)
  if (node.type === 'Literal' && typeof node.value === 'string') return [{ node, text: node.value }]
  if (node.type === 'TemplateLiteral')
    return node.quasis.map((part) => ({ node: part, text: part.value.cooked ?? part.value.raw }))
  const children =
    node.type === 'ConditionalExpression'
      ? [node.consequent, node.alternate]
      : node.type === 'LogicalExpression'
        ? [node.left, node.right]
        : node.type === 'ArrayExpression'
          ? node.elements
          : node.type === 'CallExpression' && node.callee.type === 'Identifier' && classHelpers.has(node.callee.name)
            ? node.arguments
            : node.type === 'ObjectExpression'
              ? node.properties.filter((p) => p.type === 'Property' && !p.computed).map((p) => p.key)
              : []
  return children.flatMap((child) => classStrings(context, child, seen))
}

function check(context, value, target) {
  for (const { node, text } of classStrings(context, value)) {
    const padding = text.split(/\s+/).filter(paddingClass)
    if (padding.length)
      context.report({ node, messageId: 'contentPadding', data: { target, classes: padding.join(' ') } })
  }
}

function viewportClasses(context, raw, seen = new Set()) {
  const node = resolve(context, raw)
  if (node?.type !== 'ObjectExpression' || seen.has(node)) return
  seen.add(node)
  for (const property of node.properties) {
    if (property.type === 'SpreadElement') viewportClasses(context, property.argument, seen)
    if (
      property.type === 'Property' &&
      !property.computed &&
      (property.key.name ?? property.key.value) === 'className'
    ) {
      check(context, property.value, 'viewportProps.className')
    }
  }
}

const noContainerPadding = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      contentPadding:
        'ScrollArea {{target}} contains padding ({{classes}}). Move content spacing to contentProps.className; keep the scroll boundary unpadded.'
    }
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (!isScrollArea(context, node.name)) return
        for (const attribute of node.attributes) {
          if (attribute.type !== 'JSXAttribute') continue
          if (attribute.name.name === 'className') check(context, attribute.value, 'className')
          if (attribute.name.name === 'viewportProps') viewportClasses(context, attribute.value)
        }
      }
    }
  }
}

export default { meta: { name: 'cherry-scroll-area' }, rules: { 'no-container-padding': noContainerPadding } }
