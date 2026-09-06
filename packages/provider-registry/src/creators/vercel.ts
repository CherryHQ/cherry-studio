import { defineCreator } from './types'

export default defineCreator({
  id: 'vercel',
  name: 'Vercel',
  modelsDevProviders: ['vercel'],
  idPrefixes: ['v0'],
  reasoningFamilies: [{ pattern: '^muse-spark' }, { pattern: '^interfaze' }, { pattern: '^laguna-s' }],
  models: [
    // Hand-listed so MuseSpark 1.3 resolves even before models.dev's vercel
    // listing catches up (#20096): without catalog entry the model has no
    // image-recognition capability and chat images degrade to OCR text.
    {
      id: 'muse-spark-1-3',
      name: 'Muse Spark 1.3',
      family: 'muse',
      capabilities: [
        'function-call',
        'reasoning',
        'image-recognition',
        'audio-recognition',
        'video-recognition',
        'structured-output',
        'file-input'
      ],
      inputModalities: ['text', 'image', 'video', 'audio'],
      outputModalities: ['text'],
      contextWindow: 1048576
    }
  ]
})
