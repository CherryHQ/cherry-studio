import { IMAGE_SIZES, QUALITY_OPTIONS } from './config'

export const zhipuFields = [
  {
    type: 'radio',
    key: 'quality',
    title: 'paintings.quality',
    options: QUALITY_OPTIONS.map((option) => ({ labelKey: option.label, value: option.value })),
    initialValue: 'standard',
    condition: (painting) => painting.model === 'cogview-4-250304'
  },
  {
    type: 'sizeChips',
    key: 'imageSize',
    title: 'paintings.image.size',
    options: [
      ...IMAGE_SIZES.map((size) => ({ labelKey: size.label, value: size.value })),
      { labelKey: 'paintings.custom_size', value: 'custom' }
    ],
    initialValue: '1024x1024'
  },
  {
    type: 'customSize',
    key: 'customSize',
    widthKey: 'customWidth',
    heightKey: 'customHeight',
    sizeKey: 'imageSize',
    validation: {
      minWidth: 512,
      maxWidth: 2048,
      minHeight: 512,
      maxHeight: 2048,
      divisibleBy: 16,
      maxPixels: 2097152
    },
    condition: (painting) => painting.imageSize === 'custom'
  }
] as any[]
