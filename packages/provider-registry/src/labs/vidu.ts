import { defineLab } from './types'

export default defineLab({
  id: 'vidu',
  name: 'Shengshu (Vidu)',
  idPrefixes: ['vidu', 'viduq'],
  // Video generation. Request params (duration/resolution/style) belong on the serving provider.
  models: [
    {
      id: 'viduq2',
      name: 'Vidu Q2',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'viduq2-pro',
      name: 'Vidu Q2 Pro',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    },
    {
      id: 'viduq2-ctv',
      name: 'Vidu Q2 CTV',
      capabilities: ['video-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['video']
    }
  ]
})
