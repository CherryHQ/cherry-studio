import { APICallError, InvalidResponseDataError, type SpeechModelV3 } from '@ai-sdk/provider'
import { BufferTarget, EncodedAudioPacketSource, EncodedPacket, Output, WavOutputFormat } from 'mediabunny'
import * as z from 'zod'

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z
          .object({
            parts: z.array(
              z.object({
                inlineData: z.object({ mimeType: z.string(), data: z.string().min(1) }).optional()
              })
            )
          })
          .optional()
      })
    )
    .min(1)
})

export function createGeminiSpeechModel(
  modelId: string,
  settings: {
    baseURL: string
    url?: string
    apiKey: string
    headers?: Record<string, string>
    fetch: typeof globalThis.fetch
  }
): SpeechModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'google',
    modelId,
    async doGenerate({ text, voice, abortSignal }) {
      abortSignal?.throwIfAborted()
      const url =
        settings.url ?? `${settings.baseURL.replace(/\/$/, '')}/models/${encodeURIComponent(modelId)}:generateContent`
      const response = await settings.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey, ...settings.headers },
        signal: abortSignal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
          }
        })
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new APICallError({
          message: 'Gemini speech request failed',
          url,
          requestBodyValues: undefined,
          statusCode: response.status
        })
      }
      const parsed = responseSchema.safeParse(await response.json())
      if (!parsed.success)
        throw new InvalidResponseDataError({ data: undefined, message: 'Invalid Gemini speech audio' })
      const candidate = parsed.data.candidates[0]
      if (candidate.finishReason !== 'STOP')
        throw new InvalidResponseDataError({ data: undefined, message: 'Invalid Gemini speech audio' })
      const parts = candidate.content?.parts.flatMap((part) => (part.inlineData ? [part.inlineData] : [])) ?? []
      if (parts.length === 0 || parts.some((part) => part.mimeType !== parts[0].mimeType))
        throw new InvalidResponseDataError({ data: undefined, message: 'Invalid Gemini speech audio' })
      const bytes = Buffer.concat(parts.map((part) => Buffer.from(part.data, 'base64')))
      if (!bytes.length) throw new InvalidResponseDataError({ data: undefined, message: 'Invalid Gemini speech audio' })
      const mimeType = parts[0].mimeType
      let audio: Uint8Array = bytes
      if (mimeType !== 'audio/wav' && mimeType !== 'audio/x-wav') {
        const pcm = /^audio\/L16;\s*codec=pcm;\s*rate=(\d+)$/i.exec(mimeType)
        const sampleRate = Number(pcm?.[1])
        if (!pcm || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 || bytes.length % 2)
          throw new InvalidResponseDataError({ data: undefined, message: 'Invalid Gemini speech audio' })
        const target = new BufferTarget()
        const output = new Output({ format: new WavOutputFormat(), target })
        const source = new EncodedAudioPacketSource('pcm-s16')
        output.addAudioTrack(source)
        await output.start()
        await source.add(new EncodedPacket(bytes, 'key', 0, bytes.length / 2 / sampleRate), {
          decoderConfig: { codec: 'pcm-s16', sampleRate, numberOfChannels: 1 }
        })
        await output.finalize()
        audio = new Uint8Array(target.buffer!)
      }
      abortSignal?.throwIfAborted()
      return { audio, warnings: [], response: { timestamp: new Date(), modelId } }
    }
  }
}

export const geminiSpeechVoices = [
  'Kore',
  'Zephyr',
  'Puck',
  'Charon',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat'
]
