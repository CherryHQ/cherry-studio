import { SILICON_IMAGE_SIZES } from './defaults'

export const siliconFields = [
  {
    type: 'iconRadio',
    key: 'imageSize',
    title: 'paintings.image.size',
    columns: 3,
    options: SILICON_IMAGE_SIZES.map((size) => ({ label: size.label, value: size.value, icon: size.icon })),
    initialValue: '1024x1024'
  },
  {
    type: 'iconRadio',
    key: 'numImages',
    title: 'paintings.number_images',
    tooltip: 'paintings.number_images_tip',
    columns: 4,
    options: [
      { label: '1', value: '1' },
      { label: '2', value: '2' },
      { label: '3', value: '3' },
      { label: '4', value: '4' }
    ],
    initialValue: '1'
  },
  {
    type: 'input',
    key: 'seed',
    title: 'paintings.seed',
    tooltip: 'paintings.seed_tip',
    initialValue: ''
  },
  {
    type: 'slider',
    key: 'steps',
    title: 'paintings.inference_steps',
    tooltip: 'paintings.inference_steps_tip',
    min: 1,
    max: 50,
    initialValue: 25
  },
  {
    type: 'slider',
    key: 'guidanceScale',
    title: 'paintings.guidance_scale',
    tooltip: 'paintings.guidance_scale_tip',
    min: 1,
    max: 20,
    step: 0.1,
    initialValue: 4.5
  },
  {
    type: 'textarea',
    key: 'negativePrompt',
    title: 'paintings.negative_prompt',
    tooltip: 'paintings.negative_prompt_tip'
  },
  {
    type: 'switch',
    key: 'promptEnhancement',
    title: 'paintings.prompt_enhancement',
    tooltip: 'paintings.prompt_enhancement_tip',
    initialValue: false
  }
] as any[]
