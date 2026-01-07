import { generateMcpToolFunctionName } from '@shared/mcp'
import type { MCPTool } from '@types'

import type { GeneratedTool } from './types'

type PropertySchema = Record<string, unknown>
type InputSchema = {
  type?: string
  properties?: Record<string, PropertySchema>
  required?: string[]
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
      return `${schemaTypeToTS(items)}[]`
    }
    return 'unknown[]'
  }

  if (type === 'object') {
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

function generateJSDoc(tool: MCPTool, inputSchema: InputSchema | undefined, returns: string): string {
  const lines: string[] = ['/**']

  if (tool.description) {
    const desc = tool.description.split('\n')[0]
    lines.push(` * ${desc}`)
  }

  const properties = inputSchema?.properties || {}
  const required = inputSchema?.required || []

  if (Object.keys(properties).length > 0) {
    lines.push(` * @param {Object} params`)
    for (const [name, prop] of Object.entries(properties)) {
      const isReq = required.includes(name)
      const type = schemaTypeToTS(prop)
      const paramName = isReq ? `params.${name}` : `[params.${name}]`
      const desc = (prop.description as string)?.split('\n')[0] || ''
      lines.push(` * @param {${type}} ${paramName} ${desc}`)
    }
  }

  lines.push(` * @returns {Promise<${returns}>}`)
  lines.push(` */`)

  return lines.join('\n')
}

export function generateToolFunction(
  tool: MCPTool,
  existingNames: Set<string>,
  callToolFn: (functionName: string, params: unknown) => Promise<unknown>
): GeneratedTool {
  const functionName = generateMcpToolFunctionName(tool.serverName, tool.name, existingNames)

  const inputSchema = tool.inputSchema as InputSchema | undefined
  const outputSchema = tool.outputSchema as Record<string, unknown> | undefined

  const signature = jsonSchemaToSignature(inputSchema)
  const returns = outputSchema ? jsonSchemaToSignature(outputSchema) : 'unknown'

  const jsDoc = generateJSDoc(tool, inputSchema, returns)

  const jsCode = `${jsDoc}
async function ${functionName}(params) {
  return await __callTool("${functionName}", params);
}`

  const fn = async (params: unknown): Promise<unknown> => {
    return await callToolFn(functionName, params)
  }

  return {
    serverId: tool.serverId,
    serverName: tool.serverName,
    toolName: tool.name,
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

  const header = `// ${tools.length} tool(s). ALWAYS use: const r = await ToolName({...}); return r;`
  const code = tools.map((t) => t.jsCode).join('\n\n')

  return header + '\n\n' + code
}
