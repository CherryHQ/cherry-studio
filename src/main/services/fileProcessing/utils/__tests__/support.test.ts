import type {
  FileProcessorFeatureCapability,
  FileProcessorInput,
  FileProcessorMerged
} from '@shared/data/presets/file-processing'
import { FILE_TYPE, type FileInfo } from '@shared/file/types'
import { describe, expect, it } from 'vitest'

import { assertFeatureSupportsFileInfo, assertProcessorSupportsFileType } from '../support'

const imageFileInfo = {
  path: '/tmp/scan.png' as FileInfo['path'],
  name: 'scan',
  ext: 'png',
  size: 128,
  mime: 'image/png',
  type: FILE_TYPE.IMAGE,
  createdAt: 0,
  modifiedAt: 0
} as FileInfo

const pdfFileInfo = {
  path: '/tmp/report.pdf' as FileInfo['path'],
  name: 'report',
  ext: 'pdf',
  size: 512,
  mime: 'application/pdf',
  type: FILE_TYPE.DOCUMENT,
  createdAt: 0,
  modifiedAt: 0
} as FileInfo

const wordFileInfo = {
  ...pdfFileInfo,
  path: '/tmp/report.docx' as FileInfo['path'],
  ext: 'docx',
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
} as FileInfo

function createCapability(
  feature: FileProcessorFeatureCapability['feature'],
  inputs: FileProcessorInput[]
): FileProcessorFeatureCapability {
  if (feature === 'image_to_text') {
    return {
      feature,
      inputs,
      output: FILE_TYPE.TEXT
    } as FileProcessorFeatureCapability
  }

  return {
    feature,
    inputs,
    output: 'markdown'
  } as FileProcessorFeatureCapability
}

function createConfig(capabilities: FileProcessorFeatureCapability[]): FileProcessorMerged {
  return {
    id: 'paddleocr',
    type: 'api',
    capabilities
  }
}

describe('file processing support utils', () => {
  it('allows image_to_text for images only', () => {
    expect(() => assertFeatureSupportsFileInfo(imageFileInfo, 'image_to_text')).not.toThrow()
    expect(() => assertFeatureSupportsFileInfo(pdfFileInfo, 'image_to_text')).toThrowError(
      'File processing image_to_text only supports image files'
    )
  })

  it('allows document_to_markdown for document files only', () => {
    expect(() => assertFeatureSupportsFileInfo(pdfFileInfo, 'document_to_markdown')).not.toThrow()
    expect(() => assertFeatureSupportsFileInfo({ ...pdfFileInfo, ext: 'PDF' }, 'document_to_markdown')).not.toThrow()
    expect(() => assertFeatureSupportsFileInfo(wordFileInfo, 'document_to_markdown')).not.toThrow()
    expect(() => assertFeatureSupportsFileInfo(imageFileInfo, 'document_to_markdown')).toThrowError(
      'File processing document_to_markdown only supports document files'
    )
  })

  it('rejects processors without the requested capability', () => {
    const config = createConfig([createCapability('image_to_text', [FILE_TYPE.IMAGE])])

    expect(() => assertProcessorSupportsFileType(FILE_TYPE.DOCUMENT, 'document_to_markdown', config)).toThrowError(
      'File processor paddleocr does not support document_to_markdown'
    )
  })

  it('rejects file types outside the processor capability inputs', () => {
    const config = createConfig([createCapability('document_to_markdown', [FILE_TYPE.DOCUMENT])])

    expect(() => assertProcessorSupportsFileType(FILE_TYPE.IMAGE, 'document_to_markdown', config)).toThrowError(
      'File processor paddleocr document_to_markdown does not support image files'
    )
  })
})
