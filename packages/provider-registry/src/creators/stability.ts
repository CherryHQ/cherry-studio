import { defineCreator } from './types'

export default defineCreator({
  id: 'stability',
  name: 'Stability AI',
  idPrefixes: ['stable-diffusion', 'sdxl', 'sd3', 'stable-image'],
  // Image generation. Request params (size/cfg/steps) belong on the serving provider.
  models: [
    {
      id: 'stable-diffusion-3-5-large',
      name: 'Stable Diffusion 3.5 Large',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'stable-diffusion-3-5-large-turbo',
      name: 'Stable Diffusion 3.5 Large Turbo',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'stable-diffusion-3',
      name: 'Stable Diffusion 3',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'stable-diffusion-xl-base-1-0',
      name: 'Stable Diffusion XL Base 1.0',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'stable-diffusion-v1-5',
      name: 'Stable Diffusion v1.5',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'stable-diffusion-v1-4',
      name: 'Stable Diffusion v1.4',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    }
  ]
})
