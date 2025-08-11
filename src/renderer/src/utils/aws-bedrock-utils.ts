/**
 * AWS Bedrock 相关工具函数
 */

/**
 * 支持的图片格式类型
 */
export type AwsBedrockImageFormat = 'png' | 'jpeg' | 'gif' | 'webp'

/**
 * AWS Bedrock 图片对象格式
 */
export interface AwsBedrockImage {
  format: AwsBedrockImageFormat
  source: {
    bytes: Uint8Array
  }
}

/**
 * 从 MIME 类型中提取图片格式
 * @param mimeType MIME 类型，如 'image/png'
 * @returns 图片格式或 null（如果不支持）
 */
export function extractImageFormatFromMimeType(mimeType?: string): AwsBedrockImageFormat | null {
  if (!mimeType) return null

  const format = mimeType.split('/')[1] as AwsBedrockImageFormat

  if (['png', 'jpeg', 'gif', 'webp'].includes(format)) {
    return format
  }

  return null
}

/**
 * 将 base64 字符串转换为 Uint8Array
 * @param base64Data base64 编码的字符串
 * @returns Uint8Array
 * @throws Error 如果 base64 解码失败
 */
export function base64ToUint8Array(base64Data: string): Uint8Array {
  try {
    // 在浏览器环境中正确处理base64转换为Uint8Array
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
  } catch (error) {
    throw new Error(`Failed to decode base64 data: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * 将 base64 图片数据转换为 AWS Bedrock 格式
 * @param data base64 编码的图片数据
 * @param mimeType 图片的 MIME 类型
 * @param fallbackFormat 当无法从 mimeType 中提取格式时的默认格式
 * @returns AWS Bedrock 格式的图片对象，如果格式不支持则返回 null
 */
export function convertBase64ImageToAwsBedrockFormat(
  data: string,
  mimeType?: string,
  fallbackFormat: AwsBedrockImageFormat = 'png'
): AwsBedrockImage | null {
  const format = extractImageFormatFromMimeType(mimeType) || fallbackFormat

  // 验证格式是否支持
  if (!['png', 'jpeg', 'gif', 'webp'].includes(format)) {
    return null
  }

  try {
    const bytes = base64ToUint8Array(data)

    return {
      format,
      source: {
        bytes
      }
    }
  } catch (error) {
    // 如果转换失败，返回 null
    return null
  }
}

/**
 * 检查给定的 MIME 类型是否为 AWS Bedrock 支持的图片格式
 * @param mimeType MIME 类型
 * @returns 是否支持
 */
export function isAwsBedrockSupportedImageFormat(mimeType?: string): boolean {
  return extractImageFormatFromMimeType(mimeType) !== null
}
