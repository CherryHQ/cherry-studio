import { useCallback, useEffect, useRef, useState } from 'react'

export interface RecordedSpeech {
  audioBase64: string
  mediaType: string
}

type AudioContextWithScriptProcessor = AudioContext & {
  createScriptProcessor(
    bufferSize?: number,
    numberOfInputChannels?: number,
    numberOfOutputChannels?: number
  ): ScriptProcessorNode
}

const RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4'
] as const

export function getPreferredSpeechRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined
  }

  return RECORDER_MIME_TYPES.find((mediaType) => MediaRecorder.isTypeSupported(mediaType))
}

export function encodePcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2
  const channelCount = 1
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true)
  view.setUint16(32, channelCount * bytesPerSample, true)
  view.setUint16(34, bytesPerSample * 8, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += bytesPerSample
  }

  return new Uint8Array(buffer)
}

function downmixToMono(audioBuffer: AudioBuffer): Float32Array {
  const samples = new Float32Array(audioBuffer.length)
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel)
    for (let index = 0; index < channelData.length; index += 1) {
      samples[index] += channelData[index] / audioBuffer.numberOfChannels
    }
  }
  return samples
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  const AudioContextCtor =
    window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return AudioContextCtor
}

async function convertRecordedBlobToWav(blob: Blob): Promise<Blob> {
  const AudioContextCtor = getAudioContextConstructor()
  if (!AudioContextCtor) {
    throw new Error('Audio decoding is not supported in this runtime')
  }

  const context = new AudioContextCtor()
  try {
    const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer())
    const wav = encodePcm16Wav(downmixToMono(audioBuffer), audioBuffer.sampleRate)
    return new Blob([new Uint8Array(wav).buffer], { type: 'audio/wav' })
  } finally {
    void context.close()
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read recorded audio'))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(blob)
  })
}

function concatFloat32(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const samples = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    samples.set(chunk, offset)
    offset += chunk.length
  }
  return samples
}

export function useSpeechRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const pcmChunksRef = useRef<Float32Array[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const mutedGainRef = useRef<GainNode | null>(null)
  const sampleRateRef = useRef<number | null>(null)
  const [isRecording, setIsRecording] = useState(false)

  const release = useCallback(() => {
    processorRef.current?.disconnect()
    processorRef.current = null
    sourceRef.current?.disconnect()
    sourceRef.current = null
    mutedGainRef.current?.disconnect()
    mutedGainRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []
    pcmChunksRef.current = []
    sampleRateRef.current = null
    setIsRecording(false)
  }, [])

  useEffect(() => release, [release])

  const start = useCallback(async () => {
    release()
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    try {
      const AudioContextCtor = getAudioContextConstructor()
      if (AudioContextCtor) {
        const context = new AudioContextCtor() as AudioContextWithScriptProcessor
        if (context.state === 'suspended') {
          await context.resume()
        }
        const source = context.createMediaStreamSource(stream)
        const processor = context.createScriptProcessor(4096, 1, 1)
        const mutedGain = context.createGain()
        mutedGain.gain.value = 0
        processor.onaudioprocess = (event) => {
          pcmChunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)))
        }
        source.connect(processor)
        processor.connect(mutedGain)
        mutedGain.connect(context.destination)
        audioContextRef.current = context
        sourceRef.current = source
        processorRef.current = processor
        mutedGainRef.current = mutedGain
        sampleRateRef.current = context.sampleRate
        streamRef.current = stream
        setIsRecording(true)
        return
      }

      const mimeType = getPreferredSpeechRecorderMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      })
      recorder.start()
      streamRef.current = stream
      recorderRef.current = recorder
      setIsRecording(true)
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop())
      throw error
    }
  }, [release])

  const stop = useCallback(
    () =>
      new Promise<RecordedSpeech>((resolve, reject) => {
        if (audioContextRef.current && sampleRateRef.current) {
          const samples = concatFloat32(pcmChunksRef.current)
          try {
            if (samples.length === 0) {
              throw new Error('No audio was captured. Check microphone permission and try again.')
            }
            const wav = encodePcm16Wav(samples, sampleRateRef.current)
            const blob = new Blob([new Uint8Array(wav).buffer], { type: 'audio/wav' })
            void blobToBase64(blob)
              .then((audioBase64) => {
                if (!audioBase64) {
                  throw new Error('No audio was captured. Check microphone permission and try again.')
                }
                resolve({ audioBase64, mediaType: 'audio/wav' })
              })
              .catch(reject)
              .finally(release)
          } catch (error) {
            release()
            reject(error)
          }
          return
        }

        const recorder = recorderRef.current
        if (!recorder || recorder.state === 'inactive') {
          reject(new Error('No speech recording is active'))
          return
        }
        recorder.addEventListener(
          'stop',
          () => {
            const mediaType = recorder.mimeType || 'audio/webm'
            const blob = new Blob(chunksRef.current, { type: mediaType })
            void convertRecordedBlobToWav(blob)
              .catch(() => blob)
              .then((recordedBlob) => blobToBase64(recordedBlob).then((audioBase64) => ({ audioBase64, recordedBlob })))
              .then((audioBase64) => {
                if (!audioBase64.audioBase64) {
                  throw new Error('No audio was captured. Check microphone permission and try again.')
                }
                resolve({
                  audioBase64: audioBase64.audioBase64,
                  mediaType: audioBase64.recordedBlob.type || mediaType
                })
              })
              .catch(reject)
              .finally(release)
          },
          { once: true }
        )
        recorder.stop()
      }),
    [release]
  )

  return { isRecording, start, stop, cancel: release }
}
