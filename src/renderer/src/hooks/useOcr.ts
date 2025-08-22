import { useAppSelector } from '@renderer/store'
import { ImageFileMetadata, isImageFile } from '@renderer/types'
import { SupportedOcrFile } from '@renderer/types/ocr'
import { useTranslation } from 'react-i18next'

export const useImageOcr = () => {}

export const useOcr = () => {
  const { t } = useTranslation()
  const imageProvider = useAppSelector((state) => state.ocr.imageProvider)

  /**
   * 对图片文件进行OCR识别
   * @param image 图片文件元数据
   * @returns OCR识别结果的Promise
   */
  const ocrImage = async (image: ImageFileMetadata) => {
    return window.api.ocr.ocr(image, imageProvider)
  }

  /**
   * 对支持的文件进行OCR识别
   * @param file 支持OCR的文件
   * @returns OCR识别结果的Promise
   * @throws 当文件类型不支持时抛出错误
   */
  const ocr = async (file: SupportedOcrFile) => {
    if (isImageFile(file)) {
      return ocrImage(file)
    }
    // @ts-expect-error all types should be covered
    throw new Error(t('ocr.file.not_supported', { type: file.type }))
  }

  return {
    ocrImage,
    ocr
  }
}
