import { describe, expect, it } from 'vitest'

import {
  type AwsBedrockImage,
  type AwsBedrockImageFormat,
  base64ToUint8Array,
  convertBase64ImageToAwsBedrockFormat,
  extractImageFormatFromMimeType,
  isAwsBedrockSupportedImageFormat
} from '../aws-bedrock-utils'

describe('utils/aws-bedrock-utils', () => {
  describe('extractImageFormatFromMimeType', () => {
    it('should extract png format from mime type', () => {
      expect(extractImageFormatFromMimeType('image/png')).toBe('png')
    })

    it('should extract jpeg format from mime type', () => {
      expect(extractImageFormatFromMimeType('image/jpeg')).toBe('jpeg')
    })

    it('should extract gif format from mime type', () => {
      expect(extractImageFormatFromMimeType('image/gif')).toBe('gif')
    })

    it('should extract webp format from mime type', () => {
      expect(extractImageFormatFromMimeType('image/webp')).toBe('webp')
    })

    it('should return null for unsupported mime type', () => {
      expect(extractImageFormatFromMimeType('image/bmp')).toBe(null)
      expect(extractImageFormatFromMimeType('image/svg+xml')).toBe(null)
      expect(extractImageFormatFromMimeType('image/tiff')).toBe(null)
    })

    it('should return null for invalid mime type format', () => {
      expect(extractImageFormatFromMimeType('invalid')).toBe(null)
      expect(extractImageFormatFromMimeType('text/plain')).toBe(null)
      expect(extractImageFormatFromMimeType('application/json')).toBe(null)
    })

    it('should return null for undefined or empty input', () => {
      expect(extractImageFormatFromMimeType(undefined)).toBe(null)
      expect(extractImageFormatFromMimeType('')).toBe(null)
    })

    it('should handle mime type with additional parameters', () => {
      expect(extractImageFormatFromMimeType('image/png; charset=utf-8')).toBe(null)
      expect(extractImageFormatFromMimeType('image/jpeg; quality=95')).toBe(null)
    })
  })

  describe('base64ToUint8Array', () => {
    it('should convert valid base64 string to Uint8Array', () => {
      // "hello" in base64 is "aGVsbG8="
      const base64 = 'aGVsbG8='
      const result = base64ToUint8Array(base64)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(5)
      expect(Array.from(result)).toEqual([104, 101, 108, 108, 111]) // ASCII values for "hello"
    })

    it('should convert empty base64 string to empty Uint8Array', () => {
      const result = base64ToUint8Array('')
      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(0)
    })

    it('should handle base64 with padding', () => {
      const base64 = 'YQ==' // "a" in base64
      const result = base64ToUint8Array(base64)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(1)
      expect(result[0]).toBe(97) // ASCII value for "a"
    })

    it('should handle base64 without padding', () => {
      const base64 = 'YWI' // "ab" in base64 without padding
      const result = base64ToUint8Array(base64)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(2)
      expect(Array.from(result)).toEqual([97, 98]) // ASCII values for "ab"
    })

    it('should throw error for invalid base64 string', () => {
      expect(() => base64ToUint8Array('invalid!@#$%^&*()')).toThrow('Failed to decode base64 data')
      expect(() => base64ToUint8Array('hello world!')).toThrow('Failed to decode base64 data')
    })

    it('should handle binary data correctly', () => {
      // Binary data that represents a simple image header
      const binaryData = new Uint8Array([137, 80, 78, 71]) // PNG header
      const base64 = btoa(String.fromCharCode(...binaryData))
      const result = base64ToUint8Array(base64)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(Array.from(result)).toEqual([137, 80, 78, 71])
    })
  })

  describe('convertBase64ImageToAwsBedrockFormat', () => {
    const validBase64 = 'aGVsbG8=' // "hello" in base64

    it('should convert base64 image with valid mime type', () => {
      const result = convertBase64ImageToAwsBedrockFormat(validBase64, 'image/png')

      expect(result).not.toBe(null)
      expect(result?.format).toBe('png')
      expect(result?.source.bytes).toBeInstanceOf(Uint8Array)
      expect(result?.source.bytes.length).toBe(5)
    })

    it('should use fallback format when mime type is not provided', () => {
      const result = convertBase64ImageToAwsBedrockFormat(validBase64)

      expect(result).not.toBe(null)
      expect(result?.format).toBe('png') // default fallback
      expect(result?.source.bytes).toBeInstanceOf(Uint8Array)
    })

    it('should use custom fallback format', () => {
      const result = convertBase64ImageToAwsBedrockFormat(validBase64, undefined, 'jpeg')

      expect(result).not.toBe(null)
      expect(result?.format).toBe('jpeg')
      expect(result?.source.bytes).toBeInstanceOf(Uint8Array)
    })

    it('should extract format from mime type when provided', () => {
      const result = convertBase64ImageToAwsBedrockFormat(validBase64, 'image/webp', 'png')

      expect(result).not.toBe(null)
      expect(result?.format).toBe('webp') // extracted from mime type, not fallback
    })

    it('should use fallback format for unsupported mime type', () => {
      const result = convertBase64ImageToAwsBedrockFormat(validBase64, 'image/bmp')

      expect(result).not.toBe(null)
      expect(result?.format).toBe('png') // uses fallback format
    })

    it('should return null for invalid base64 data', () => {
      const result = convertBase64ImageToAwsBedrockFormat('invalid!@#$%^&*()', 'image/png')

      expect(result).toBe(null)
    })

    it('should return null for invalid fallback format', () => {
      // @ts-ignore - testing invalid fallback format
      const result = convertBase64ImageToAwsBedrockFormat(validBase64, undefined, 'bmp')

      expect(result).toBe(null)
    })

    it('should handle all supported formats', () => {
      const formats: AwsBedrockImageFormat[] = ['png', 'jpeg', 'gif', 'webp']

      formats.forEach((format) => {
        const result = convertBase64ImageToAwsBedrockFormat(validBase64, `image/${format}`)
        expect(result).not.toBe(null)
        expect(result?.format).toBe(format)
      })
    })

    it('should return proper AwsBedrockImage structure', () => {
      const result = convertBase64ImageToAwsBedrockFormat(validBase64, 'image/png')

      expect(result).toEqual({
        format: 'png',
        source: {
          bytes: expect.any(Uint8Array)
        }
      } as AwsBedrockImage)
    })

    it('should handle empty base64 string', () => {
      const result = convertBase64ImageToAwsBedrockFormat('', 'image/png')

      expect(result).not.toBe(null)
      expect(result?.format).toBe('png')
      expect(result?.source.bytes).toBeInstanceOf(Uint8Array)
      expect(result?.source.bytes.length).toBe(0)
    })
  })

  describe('isAwsBedrockSupportedImageFormat', () => {
    it('should return true for supported formats', () => {
      expect(isAwsBedrockSupportedImageFormat('image/png')).toBe(true)
      expect(isAwsBedrockSupportedImageFormat('image/jpeg')).toBe(true)
      expect(isAwsBedrockSupportedImageFormat('image/gif')).toBe(true)
      expect(isAwsBedrockSupportedImageFormat('image/webp')).toBe(true)
    })

    it('should return false for unsupported formats', () => {
      expect(isAwsBedrockSupportedImageFormat('image/bmp')).toBe(false)
      expect(isAwsBedrockSupportedImageFormat('image/svg+xml')).toBe(false)
      expect(isAwsBedrockSupportedImageFormat('image/tiff')).toBe(false)
    })

    it('should return false for non-image mime types', () => {
      expect(isAwsBedrockSupportedImageFormat('text/plain')).toBe(false)
      expect(isAwsBedrockSupportedImageFormat('application/json')).toBe(false)
      expect(isAwsBedrockSupportedImageFormat('video/mp4')).toBe(false)
    })

    it('should return false for invalid mime types', () => {
      expect(isAwsBedrockSupportedImageFormat('invalid')).toBe(false)
      expect(isAwsBedrockSupportedImageFormat('image/')).toBe(false)
      expect(isAwsBedrockSupportedImageFormat('/bmp')).toBe(false)
    })

    it('should return false for undefined or empty input', () => {
      expect(isAwsBedrockSupportedImageFormat(undefined)).toBe(false)
      expect(isAwsBedrockSupportedImageFormat('')).toBe(false)
    })

    it('should return false for mime types with additional parameters', () => {
      expect(isAwsBedrockSupportedImageFormat('image/png; charset=utf-8')).toBe(false)
      expect(isAwsBedrockSupportedImageFormat('image/jpeg; quality=95')).toBe(false)
    })
  })
})
