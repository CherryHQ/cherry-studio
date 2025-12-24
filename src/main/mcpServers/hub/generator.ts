import type { MCPServer, MCPTool } from '@types'

import type { GeneratedTool } from './types'

function toCamelCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase())
    .replace(/[^a-zA-Z0-9]/g, '')
}

function makeUniqueFunctionName(baseName: string, existingNames: Set<string>): string {
  let name = baseName
  let counter = 1
  while (existingNames.has(name)) {
    name = `${baseName}${counter}`
    counter++
  }
  existingNames.add(name)
  return name
}

function jsonSchemaToSignature(schema: Record<string, unknown> | undefined): string {
  if (!schema || typeof schema !== 'object') {
    return '{}'
  }

  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
  if (!properties) {
    return '{}'
  }

  const required = (schema.required as string[]) || []
  const parts: string[] = []

  for (const [key, prop] of Object.entries(properties)) {
    const isRequired = required.includes(key)
    const typeStr = schemaTypeToTS(prop)
    parts.push(`${key}${isRequired ? '' : '?'}: ${typeStr}`)
  }

  return `{ ${parts.join(', ')} }`
}

function schemaTypeToTS(prop: Record<string, unknown>): string {
  const type = prop.type as string | string[] | undefined
  const enumValues = prop.enum as unknown[] | undefined

  if (enumValues && Array.isArray(enumValues)) {
    return enumValues.map((v) => (typeof v === 'string' ? `"${v}"` : String(v))).join(' | ')
  }

  if (Array.isArray(type)) {
    return type.map((t) => primitiveTypeToTS(t)).join(' | ')
  }

  if (type === 'array') {
    const items = prop.items as Record<string, unknown> | undefined
    if (items) {
      return `Array<${schemaTypeToTS(items)}>`
    }
    return 'Array<unknown>'
  }

  if (type === 'object') {
    const properties = prop.properties as Record<string, Record<string, unknown>> | undefined
    if (properties) {
      return jsonSchemaToSignature(prop)
    }
    return 'object'
  }

  return primitiveTypeToTS(type)
}

function primitiveTypeToTS(type: string | undefined): string {
  switch (type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    default:
      return 'unknown'
  }
}

function generateJSDoc(tool: MCPTool, signature: string, returns: string): string {
  const lines: string[] = ['/**']

  if (tool.description) {
    const descLines = tool.description.split('\n')
    for (const line of descLines) {
      lines.push(` * ${line}`)
    }
  }

  lines.push(` *`)
  lines.push(` * @param {${signature}} params`)
  lines.push(` * @returns {Promise<${returns}>}`)
  lines.push(` */`)

  return lines.join('\n')
}

export function generateToolFunction(
  tool: MCPTool,
  server: MCPServer,
  existingNames: Set<string>,
  callToolFn: (toolId: string, params: unknown) => Promise<unknown>
): GeneratedTool {
  const toolId = `${server.id}__${tool.name}`
  const baseName = toCamelCase(tool.name)
  const functionName = makeUniqueFunctionName(baseName, existingNames)

  const inputSchema = tool.inputSchema as Record<string, unknown> | undefined
  const outputSchema = tool.outputSchema as Record<string, unknown> | undefined

  const signature = jsonSchemaToSignature(inputSchema)
  const returns = outputSchema ? jsonSchemaToSignature(outputSchema) : 'unknown'

  const jsDoc = generateJSDoc(tool, signature, returns)

  const jsCode = `${jsDoc}
async function ${functionName}(params) {
  return await __callTool("${toolId}", params);
}`

  const fn = async (params: unknown): Promise<unknown> => {
    return await callToolFn(toolId, params)
  }

  return {
    serverId: server.id,
    serverName: server.name,
    toolName: tool.name,
    toolId,
    functionName,
    jsCode,
    fn,
    signature,
    returns,
    description: tool.description
  }
}

export function generateToolsCode(tools: GeneratedTool[]): string {
  if (tools.length === 0) {
    return '// No tools available'
  }

  const header = `// Found ${tools.length} tool(s):\n`
  const code = tools.map((t) => t.jsCode).join('\n\n')

  return header + '\n' + code
}
