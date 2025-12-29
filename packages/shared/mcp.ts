/**
 * Convert a string to camelCase, ensuring it's a valid JavaScript identifier.
 */
export function toCamelCase(str: string): string {
  let result = str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase())
    .replace(/[^a-zA-Z0-9]/g, '')

  // Ensure valid JS identifier: must start with letter or underscore
  if (result && !/^[a-zA-Z_]/.test(result)) {
    result = '_' + result
  }

  return result
}

/**
 * Generate a unique function name from server name and tool name.
 * Format: serverName_toolName (camelCase)
 */
export function generateMcpToolFunctionName(
  serverName: string | undefined,
  toolName: string,
  existingNames?: Set<string>
): string {
  const serverPrefix = serverName ? toCamelCase(serverName) : ''
  const toolNameCamel = toCamelCase(toolName)
  const baseName = serverPrefix ? `${serverPrefix}_${toolNameCamel}` : toolNameCamel

  if (!existingNames) {
    return baseName
  }

  let name = baseName
  let counter = 1
  while (existingNames.has(name)) {
    name = `${baseName}${counter}`
    counter++
  }
  existingNames.add(name)
  return name
}
