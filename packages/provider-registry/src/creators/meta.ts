import { defineCreator } from './types'

export default defineCreator({
  id: 'meta',
  name: 'Meta (Llama)',
  families: ['llama'],
  idPrefixes: ['llama', 'codellama', 'code-llama'],
  reasoningFamilies: [{ pattern: '^muse-spark' }],
  models: [
    // Hand-listed so MuseSpark 1.3 resolves even before models.dev's meta
    // listing sync catches up (#20096): without a catalog entry the model has
    // no image-recognition capability and chat images degrade to OCR text.
    // Meta is the lineage owner (models.dev meta listing; OpenRouter serves it
    // as meta/muse-spark-1.3) — Vercel only resells it on its gateway.
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
