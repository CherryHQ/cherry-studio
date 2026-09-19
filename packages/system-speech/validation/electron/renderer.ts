import { webmOpusToWav } from '../../src/webmToWav'

interface ValidationBridge {
  complete(result: {
    metadata: {
      mimeType: string
      sourceDuration: number
      derivedDuration: number
      sampleRate: number
      channels: number
    }
    webm: Uint8Array
    wav: Uint8Array
  }): void
  fail(message: string): void
  readSourceWav(): Promise<Uint8Array>
}

declare global {
  interface Window {
    systemSpeechValidation: ValidationBridge
  }
}

const MIME_TYPE = 'audio/webm;codecs=opus'

async function recordBufferAsWebm(context: AudioContext, buffer: AudioBuffer): Promise<Blob> {
  if (!MediaRecorder.isTypeSupported(MIME_TYPE)) {
    throw new Error('unsupported_recording_format')
  }

  const destination = context.createMediaStreamDestination()
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(destination)

  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(destination.stream, { mimeType: MIME_TYPE })
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  })

  const stopped = new Promise<void>((resolve, reject) => {
    recorder.addEventListener('stop', () => resolve(), { once: true })
    recorder.addEventListener('error', () => reject(new Error('media_recorder_failed')), { once: true })
  })
  source.addEventListener('ended', () => recorder.stop(), { once: true })

  recorder.start()
  source.start()
  await stopped
  return new Blob(chunks, { type: MIME_TYPE })
}

async function run(): Promise<void> {
  const context = new AudioContext()
  try {
    await context.resume()
    const sourceBytes = await window.systemSpeechValidation.readSourceWav()
    const sourceArrayBuffer = sourceBytes.buffer.slice(
      sourceBytes.byteOffset,
      sourceBytes.byteOffset + sourceBytes.byteLength
    ) as ArrayBuffer
    const sourceBuffer = await context.decodeAudioData(sourceArrayBuffer)
    const webm = await recordBufferAsWebm(context, sourceBuffer)
    const converted = await webmOpusToWav(webm)
    window.systemSpeechValidation.complete({
      metadata: {
        mimeType: MIME_TYPE,
        sourceDuration: sourceBuffer.duration,
        derivedDuration: converted.durationSeconds,
        sampleRate: converted.sampleRate,
        channels: converted.channels
      },
      webm: new Uint8Array(await webm.arrayBuffer()),
      wav: converted.wav
    })
  } finally {
    await context.close()
  }
}

run().catch((error) => {
  window.systemSpeechValidation.fail(error instanceof Error ? error.message : String(error))
})
