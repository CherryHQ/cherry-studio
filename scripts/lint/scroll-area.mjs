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

function scrollComponent(context, name) {
  const identifier = name.type === 'JSXMemberExpression' ? name.object : name
  const def = definition(context, identifier)
  if (def?.type !== 'ImportBinding') return undefined
  const source = def.parent.source.value
  const shared =
    /^@cherrystudio\/ui(?:\/components(?:\/primitives(?:\/scroll-area)?)?)?$/.test(source) ||
    (source.startsWith('.') &&
      path
        .resolve(path.dirname(context.filename), source)
        .replace(/\.(tsx?|jsx?)$/, '')
        .endsWith('/packages/ui/src/components/primitives/scroll-area'))
  const settings = source === '@renderer/components/SettingsPrimitives'
  const virtual =
    /^@renderer\/components\/VirtualList(?:\/(?:DynamicVirtualList|GroupedVirtualList|GroupedSortableVirtualList))?$/.test(
      source
    ) ||
    (source.startsWith('.') &&
      /\/src\/renderer\/components\/VirtualList(?:\/(?:DynamicVirtualList|GroupedVirtualList|GroupedSortableVirtualList))?$/.test(
        path.resolve(path.dirname(context.filename), source).replace(/\.(tsx?|jsx?)$/, '')
      ))
  if (!shared && !settings && !virtual) return undefined
  const exportedName =
    name.type === 'JSXMemberExpression'
      ? def.node.type === 'ImportNamespaceSpecifier' && name.property.name
      : def.node.type === 'ImportSpecifier'
        ? def.node.imported.name
        : def.node.type === 'ImportDefaultSpecifier' && virtual
          ? path.basename(source)
          : undefined
  if (virtual)
    return ['DynamicVirtualList', 'GroupedVirtualList', 'GroupedSortableVirtualList'].includes(exportedName)
      ? { name: exportedName, virtual: true }
      : undefined
  return exportedName === (settings ? 'SettingsContentColumn' : 'ScrollArea')
    ? { name: exportedName, virtual: false }
    : undefined
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
  return /^!?(?:p(?:[xytrblse]|[bi][se]?)?-|\[padding(?:-[\w-]+)?:)/.test(token.slice(start))
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

function check(context, value, target, component) {
  for (const { node, text } of classStrings(context, value)) {
    const padding = text.split(/\s+/).filter(paddingClass)
    if (padding.length)
      context.report({ node, messageId: 'contentPadding', data: { component, target, classes: padding.join(' ') } })
  }
}

function objectProperties(context, raw, seen = new Set()) {
  const node = resolve(context, raw)
  if (node?.type !== 'ObjectExpression' || seen.has(node)) return []
  seen.add(node)
  return node.properties.flatMap((property) =>
    property.type === 'SpreadElement'
      ? objectProperties(context, property.argument, seen)
      : property.type === 'Property' && !property.computed
        ? [{ name: property.key.name ?? property.key.value, value: property.value }]
        : []
  )
}

function checkStyle(context, value, target, component) {
  for (const property of objectProperties(context, value)) {
    if (/^padding(?:[A-Z]|$)/.test(property.name))
      context.report({
        node: property.value,
        messageId: 'contentPadding',
        data: { component, target, classes: property.name }
      })
  }
}

function checkViewport(context, value, component) {
  for (const property of objectProperties(context, value)) {
    if (property.name === 'className') check(context, property.value, 'viewportProps.className', component)
    if (property.name === 'style') checkStyle(context, property.value, 'viewportProps.style', component)
  }
}

const noContainerPadding = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      contentPadding:
        '{{component}} {{target}} contains padding ({{classes}}). Move content spacing to contentProps.className; keep the scroll boundary unpadded.'
    }
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const component = scrollComponent(context, node.name)
        if (!component) return
        const attributes = node.attributes.flatMap((attribute) =>
          attribute.type === 'JSXAttribute'
            ? [{ name: attribute.name.name, value: attribute.value }]
            : objectProperties(context, attribute.argument)
        )
        if (
          component.virtual &&
          attributes.some(
            (attribute) =>
              attribute.name === 'externalScrollElement' && resolve(context, attribute.value)?.name !== 'undefined'
          )
        )
          return
        for (const attribute of attributes) {
          if (attribute.name === 'className' || (component.virtual && attribute.name === 'scrollAreaClassName'))
            check(context, attribute.value, attribute.name, component.name)
          if (!component.virtual && attribute.name === 'viewportProps')
            checkViewport(context, attribute.value, component.name)
          if (attribute.name === (component.virtual ? 'scrollerStyle' : 'style'))
            checkStyle(context, attribute.value, attribute.name, component.name)
        }
      }
    }
  }
}

export default { meta: { name: 'cherry-scroll-area' }, rules: { 'no-container-padding': noContainerPadding } }
