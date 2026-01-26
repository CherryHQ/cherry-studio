/**
 * Mock Processor for Testing
 *
 * Provides reusable mock implementations of file processors for unit tests.
 */

import type { FileProcessorMerged, FileProcessorTemplate } from '@shared/data/presets/fileProcessing'
import type { ProcessingResult, ProcessResultResponse } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'

import { BaseFileProcessor } from '../../base/BaseFileProcessor'
import { BaseMarkdownConverter } from '../../base/BaseMarkdownConverter'
import { BaseTextExtractor } from '../../base/BaseTextExtractor'
import type { IMarkdownConverter, IProcessStatusProvider, ITextExtractor } from '../../interfaces'
import type { ProcessingContext } from '../../types'

/**
 * Create a mock FileProcessorTemplate with optional overrides
 */
export function createMockTemplate(overrides?: Partial<FileProcessorTemplate>): FileProcessorTemplate {
  return {
    id: 'mock-processor',
    type: 'builtin',
    capabilities: [{ feature: 'text_extraction', input: 'image', output: 'text' }],
    ...overrides
  }
}

/**
 * Create a dual-capability template (supports both text_extraction and markdown_conversion)
 */
export function createDualCapabilityTemplate(overrides?: Partial<FileProcessorTemplate>): FileProcessorTemplate {
  return {
    id: 'dual-processor',
    type: 'api',
    capabilities: [
      {
        feature: 'text_extraction',
        input: 'image',
        output: 'text',
        apiHost: 'https://ocr.example.com'
      },
      {
        feature: 'markdown_conversion',
        input: 'document',
        output: 'markdown',
        apiHost: 'https://markdown.example.com'
      }
    ],
    ...overrides
  }
}

/**
 * Create a mock FileProcessorMerged with optional overrides
 */
export function createMockConfig(overrides?: Partial<FileProcessorMerged>): FileProcessorMerged {
  const template = createMockTemplate()
  return {
    ...template,
    apiKey: undefined,
    options: undefined,
    ...overrides
  }
}

/**
 * Create a mock FileMetadata with optional overrides
 */
export function createMockFileMetadata(overrides?: Partial<FileMetadata>): FileMetadata {
  return {
    id: 'test-file-id',
    name: 'test-file.png',
    origin_name: 'test-file.png',
    path: '/path/to/test-file.png',
    size: 1024,
    ext: '.png',
    type: FileTypes.IMAGE,
    created_at: new Date().toISOString(),
    count: 1,
    ...overrides
  }
}

/**
 * Create a mock ProcessingContext
 */
export function createMockContext(overrides?: Partial<ProcessingContext>): ProcessingContext {
  return {
    requestId: 'test-request-id',
    ...overrides
  }
}

/**
 * Mock TextExtractor for testing BaseTextExtractor
 */
export class MockTextExtractor extends BaseTextExtractor {
  doExtractTextMock =
    vi.fn<(input: FileMetadata, config: FileProcessorMerged, context: ProcessingContext) => Promise<ProcessingResult>>()

  async extractText(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    this.checkCancellation(context)
    this.validateFile(input)
    return this.doExtractTextMock(input, config, context)
  }
}

/**
 * Mock MarkdownConverter for testing BaseMarkdownConverter
 */
export class MockMarkdownConverter extends BaseMarkdownConverter {
  doConvertMock =
    vi.fn<(input: FileMetadata, config: FileProcessorMerged, context: ProcessingContext) => Promise<ProcessingResult>>()

  async convertToMarkdown(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    this.checkCancellation(context)
    await this.validateFile(input)
    return this.doConvertMock(input, config, context)
  }
}

/**
 * Mock Dual-capability Processor for testing processors that support both
 * text extraction and markdown conversion (like PaddleOCR)
 *
 * This demonstrates how a processor can implement multiple interfaces.
 */
export class MockDualProcessor extends BaseFileProcessor implements ITextExtractor, IMarkdownConverter {
  doExtractTextMock =
    vi.fn<(input: FileMetadata, config: FileProcessorMerged, context: ProcessingContext) => Promise<ProcessingResult>>()

  doConvertMock =
    vi.fn<(input: FileMetadata, config: FileProcessorMerged, context: ProcessingContext) => Promise<ProcessingResult>>()

  async extractText(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    this.checkCancellation(context)
    this.validateFile(input)
    return this.doExtractTextMock(input, config, context)
  }

  async convertToMarkdown(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    this.checkCancellation(context)
    this.validateFile(input)
    return this.doConvertMock(input, config, context)
  }
}

/**
 * Mock Async Processor implementing IProcessStatusProvider
 *
 * For testing async processors that return a providerTaskId and require
 * status polling via getStatus().
 */
export class MockAsyncProcessor extends BaseMarkdownConverter implements IProcessStatusProvider {
  doConvertMock =
    vi.fn<(input: FileMetadata, config: FileProcessorMerged, context: ProcessingContext) => Promise<ProcessingResult>>()

  getStatusMock = vi.fn<(providerTaskId: string, config: FileProcessorMerged) => Promise<ProcessResultResponse>>()

  async convertToMarkdown(
    input: FileMetadata,
    config: FileProcessorMerged,
    context: ProcessingContext
  ): Promise<ProcessingResult> {
    this.checkCancellation(context)
    await this.validateFile(input)
    return this.doConvertMock(input, config, context)
  }

  async getStatus(providerTaskId: string, config: FileProcessorMerged): Promise<ProcessResultResponse> {
    return this.getStatusMock(providerTaskId, config)
  }
}
