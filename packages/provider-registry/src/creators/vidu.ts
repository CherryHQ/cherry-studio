import { defineCreator } from './types'

export default defineCreator({
  id: 'vidu',
  name: 'Shengshu (Vidu)',
  idPrefixes: ['vidu', 'viduq'],
  // Q3 = video (text/image → video); Q2/Q1 expose a text-to-image mode (生图).
  // Request params (duration/resolution/style) belong on the serving provider.
  models: [
    {
      id: 'viduq3-pro',
      name: 'Vidu Q3 Pro',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'viduq3-turbo',
      name: 'Vidu Q3 Turbo',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'viduq3-pro-fast',
      name: 'Vidu Q3 Pro Fast',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'viduq2',
      name: 'Vidu Q2',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    },
    {
      id: 'viduq1',
      name: 'Vidu Q1',
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      outputModalities: ['image']
    }
  ]
})
