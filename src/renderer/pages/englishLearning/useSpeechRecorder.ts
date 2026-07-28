import { useCallback, useEffect, useRef, useState } from 'react'

export interface RecordedSpeech {
  audioBase64: string
  mediaType: string
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read recorded audio'))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(blob)
  })
}

export function useSpeechRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [isRecording, setIsRecording] = useState(false)

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []
    setIsRecording(false)
  }, [])

  useEffect(() => release, [release])

  const start = useCallback(async () => {
    release()
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream)
    chunksRef.current = []
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    })
    recorder.start()
    streamRef.current = stream
    recorderRef.current = recorder
    setIsRecording(true)
  }, [release])

  const stop = useCallback(
    () =>
      new Promise<RecordedSpeech>((resolve, reject) => {
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
            void blobToBase64(blob)
              .then((audioBase64) => resolve({ audioBase64, mediaType }))
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
