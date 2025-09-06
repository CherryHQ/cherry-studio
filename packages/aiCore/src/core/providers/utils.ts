/**
 * 格式化私钥，确保它包含正确的PEM头部和尾部
 */
export function formatPrivateKey(privateKey: string): string {
  if (!privateKey || typeof privateKey !== 'string') {
    throw new Error('Private key must be a non-empty string')
  }

  // 先处理 JSON 字符串中的转义换行符
  const key = privateKey.replace(/\\n/g, '\n')

  // 检查是否已经是正确格式的 PEM 私钥
  const hasBeginMarker = key.includes('-----BEGIN PRIVATE KEY-----')
  const hasEndMarker = key.includes('-----END PRIVATE KEY-----')

  if (hasBeginMarker && hasEndMarker) {
    // 已经是 PEM 格式，但可能格式不规范，重新格式化
    return normalizePemFormat(key)
  }

  // 如果没有完整的 PEM 头尾，尝试重新构建
  return reconstructPemKey(key)
}

/**
 * 标准化 PEM 格式
 */
function normalizePemFormat(pemKey: string): string {
  // 分离头部、内容和尾部
  const lines = pemKey
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  let keyContent = ''
  let foundBegin = false
  let foundEnd = false

  for (const line of lines) {
    if (line === '-----BEGIN PRIVATE KEY-----') {
      foundBegin = true
      continue
    }
    if (line === '-----END PRIVATE KEY-----') {
      foundEnd = true
      break
    }
    if (foundBegin && !foundEnd) {
      keyContent += line
    }
  }

  if (!foundBegin || !foundEnd || !keyContent) {
    throw new Error('Invalid PEM format: missing BEGIN/END markers or key content')
  }

  // 重新格式化为 64 字符一行
  const formattedContent = keyContent.match(/.{1,64}/g)?.join('\n') || keyContent

  return `-----BEGIN PRIVATE KEY-----\n${formattedContent}\n-----END PRIVATE KEY-----`
}

/**
 * 重新构建 PEM 私钥
 */
function reconstructPemKey(key: string): string {
  // 移除所有空白字符和可能存在的不完整头尾
  let cleanKey = key.replace(/\s+/g, '')
  cleanKey = cleanKey.replace(/-----BEGIN[^-]*-----/g, '')
  cleanKey = cleanKey.replace(/-----END[^-]*-----/g, '')

  // 确保私钥内容不为空
  if (!cleanKey) {
    throw new Error('Private key content is empty after cleaning')
  }

  // 验证是否是有效的 Base64 字符
  if (!/^[A-Za-z0-9+/=]+$/.test(cleanKey)) {
    throw new Error('Private key contains invalid characters (not valid Base64)')
  }

  // 格式化为 64 字符一行
  const formattedKey = cleanKey.match(/.{1,64}/g)?.join('\n') || cleanKey

  return `-----BEGIN PRIVATE KEY-----\n${formattedKey}\n-----END PRIVATE KEY-----`
}
