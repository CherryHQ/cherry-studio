import { Badge, Button, Input, Tabs, TabsList, TabsTrigger, Textarea } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { PronunciationDiagnosis, ResolvedSpeechCapabilities, ScenarioTurn } from '@shared/ai/speech'
import type { PracticeMode } from '@shared/data/types/englishLearning'
import { Mic, Play, Square, StopCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { decodePcmWav, decodePlaybackAudio } from './audioPlayback'
import {
  buildCardSpeakingTask,
  buildCardTargetLine,
  getCardSpeakingTaskKey,
  normalizeCefr,
  type SpeakingCefr,
  speakingTaskTranslationKeys
} from './speakingTasks'
import { type RecordedSpeech, useSpeechRecorder } from './useSpeechRecorder'

interface PlaybackHandle {
  pause: () => void
}

async function playPcmWavAudio(bytes: Uint8Array): Promise<PlaybackHandle> {
  const wav = decodePcmWav(bytes)
  const AudioContextCtor =
    window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) {
    throw new Error('Web Audio is unavailable in this window')
  }

  const context = new AudioContextCtor()
  const buffer = context.createBuffer(wav.channels.length, wav.channels[0]?.length ?? 0, wav.sampleRate)
  wav.channels.forEach((channel, index) => {
    buffer.copyToChannel(new Float32Array(channel), index)
  })
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  source.start()
  source.addEventListener(
    'ended',
    () => {
      void context.close()
    },
    { once: true }
  )
  return {
    pause: () => {
      try {
        source.stop()
      } catch {
        // Already stopped.
      }
      void context.close()
    }
  }
}

async function playBase64Audio(audioBase64: string, mediaType: string): Promise<PlaybackHandle> {
  if (!audioBase64) {
    throw new Error('Speech synthesis returned empty audio')
  }
  const audioData = decodePlaybackAudio(audioBase64, mediaType)
  if (audioData.mediaType === 'audio/wav') {
    return playPcmWavAudio(audioData.bytes)
  }

  const audioBuffer = new ArrayBuffer(audioData.bytes.byteLength)
  new Uint8Array(audioBuffer).set(audioData.bytes)
  const url = URL.createObjectURL(new Blob([audioBuffer], { type: audioData.mediaType }))
  const audio = new Audio(url)
  audio.preload = 'auto'
  audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
  audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true })
  try {
    await audio.play()
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  return audio
}

export function SpeakingPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<PracticeMode>('scenario')
  const [capabilities, setCapabilities] = useState<ResolvedSpeechCapabilities | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [scenario, setScenario] = useState(t('english_learning.speaking.default_scenario'))
  const [result, setResult] = useState<{
    reply?: string
    feedback: string[]
    pronunciation?: PronunciationDiagnosis
  } | null>(null)
  const [turns, setTurns] = useState<ScenarioTurn[]>([])
  const [isWorking, setIsWorking] = useState(false)
  const [isRealtimeActive, setIsRealtimeActive] = useState(false)
  const sessionIdRef = useRef<string | null>(null)
  const audioRef = useRef<PlaybackHandle | null>(null)
  const realtimePeerRef = useRef<RTCPeerConnection | null>(null)
  const realtimeStreamRef = useRef<MediaStream | null>(null)
  const realtimeAudioRef = useRef<HTMLAudioElement | null>(null)
  const recorder = useSpeechRecorder()
  const { data: queue } = useQuery('/english-learning/reviews/today', { query: { limit: 10 } })
  const { trigger: createSession } = useMutation('POST', '/english-learning/practice/sessions')
  const { trigger: addAttempt } = useMutation('POST', '/english-learning/practice/sessions/:id/attempts')
  const { trigger: finishSession } = useMutation('PATCH', '/english-learning/practice/sessions/:id')
  const targetUnit = queue?.items[0]?.unit
  const targetCefr = normalizeCefr(targetUnit?.cefr)
  const targetTaskUnit = targetUnit ?? { cefr: targetCefr, english: '', meaning: '' }
  const taskInstruction = buildCardSpeakingTask(mode, targetTaskUnit)
  const taskLabel = t(speakingTaskTranslationKeys[getCardSpeakingTaskKey(mode, targetTaskUnit)])

  const prompt = useMemo(() => {
    if (mode === 'scenario') return scenario
    if (!targetUnit) return t('english_learning.speaking.no_target')
    return mode === 'shadowing' ? targetUnit.english : targetUnit.meaning
  }, [mode, scenario, t, targetUnit])

  const scenarioCefr = useMemo<SpeakingCefr>(() => {
    const queueLevels = queue?.items.map((item) => normalizeCefr(item.unit.cefr)) ?? []
    if (queueLevels.includes('C2')) return 'C2'
    if (queueLevels.includes('C1')) return 'C1'
    if (queueLevels.includes('B2')) return 'B2'
    if (queueLevels.includes('B1')) return 'B1'
    if (queueLevels.includes('A2')) return 'A2'
    return 'A1'
  }, [queue])

  const stopRealtime = useCallback(() => {
    realtimePeerRef.current?.close()
    realtimePeerRef.current = null
    realtimeStreamRef.current?.getTracks().forEach((track) => track.stop())
    realtimeStreamRef.current = null
    realtimeAudioRef.current?.pause()
    realtimeAudioRef.current = null
    setIsRealtimeActive(false)
  }, [])

  useEffect(() => {
    void ipcApi
      .request('speech.capabilities')
      .then(setCapabilities)
      .catch(() => setCapabilities(null))
  }, [])

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(
    () => () => {
      stopRealtime()
      const activeSessionId = sessionIdRef.current
      if (activeSessionId) {
        void ipcApi.request('speech.cancel', { sessionId: activeSessionId })
        void finishSession({ params: { id: activeSessionId }, body: { status: 'interrupted' } })
      }
    },
    [finishSession, stopRealtime]
  )

  const realtimeInstructions = useMemo(() => {
    const targets = queue?.items
      .slice(0, 8)
      .map((item) => `- ${buildCardTargetLine(item.unit)}`)
      .join('\n')
    return [
      '# Role and Objective',
      'You are an English speaking coach for a Chinese native speaker working toward native-level English.',
      'Run full-duplex spoken practice. Keep turns short, natural, and useful.',
      '',
      '# Scenario',
      mode === 'scenario' ? scenario : `Practice mode: ${mode}. Prompt: ${prompt}`,
      '',
      '# Difficulty',
      `Current target CEFR: ${mode === 'scenario' ? scenarioCefr : targetCefr}.`,
      buildCardSpeakingTask(mode, targetUnit ?? { cefr: scenarioCefr, english: '', meaning: '' }),
      '',
      '# Card-driven targets',
      targets || 'No review cards are available today.',
      '',
      '# Coaching Rules',
      'Prefer English. Use Chinese only when the learner asks for explanation or appears blocked.',
      'Correct one or two high-impact issues per turn instead of interrupting every small mistake.',
      'For B1 content, ask for short retells. For B2/C1 content, ask scenario-transfer and opinion questions.',
      'When audio is unclear, ask the learner to repeat instead of guessing.'
    ].join('\n')
  }, [mode, prompt, queue, scenario, scenarioCefr, targetCefr, targetUnit])

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId
    const created = await createSession({
      body: {
        mode,
        scenario: mode === 'scenario' ? scenario : undefined,
        modelId: capabilities?.models.chat?.modelId,
        providerId: capabilities?.models.chat?.providerId
      }
    })
    setSessionId(created.id)
    return created.id
  }, [capabilities, createSession, mode, scenario, sessionId])

  const submitTranscript = useCallback(
    async (spokenText: string, recording?: RecordedSpeech) => {
      if (!spokenText.trim()) return
      setIsWorking(true)
      try {
        const activeSessionId = await ensureSession()
        if (mode === 'scenario') {
          const response = await ipcApi.request('speech.scenario_reply', {
            sessionId: activeSessionId,
            scenario,
            cefr: scenarioCefr,
            targets: queue?.items.slice(0, 8).map((item) => buildCardTargetLine(item.unit)) ?? [],
            turns,
            transcript: spokenText
          })
          const nextTurns: ScenarioTurn[] = [
            ...turns,
            { role: 'user', text: spokenText },
            { role: 'assistant', text: response.reply }
          ]
          setTurns(nextTurns)
          setResult({ reply: response.reply, feedback: [...response.corrections, ...response.feedback] })
          await addAttempt({
            params: { id: activeSessionId },
            body: {
              prompt: scenario,
              transcript: spokenText,
              responseText: response.reply,
              feedback: { feedback: [...response.corrections, ...response.feedback] },
              durationMs: 0
            }
          })
          if (capabilities?.capabilities.synthesis) {
            const speech = await ipcApi.request('speech.synthesize', {
              sessionId: activeSessionId,
              text: response.reply
            })
            audioRef.current = await playBase64Audio(speech.audioBase64, speech.mediaType)
          }
        } else if (targetUnit) {
          const response = await ipcApi.request('speech.evaluate', {
            sessionId: activeSessionId,
            mode,
            target: targetUnit.english,
            meaning: targetUnit.meaning,
            cefr: targetCefr,
            taskInstruction,
            transcript: spokenText,
            audioBase64: recording?.audioBase64,
            mediaType: recording?.mediaType
          })
          setResult({
            reply: response.correctedText,
            feedback: response.feedback,
            pronunciation: response.pronunciation
          })
          await addAttempt({
            params: { id: activeSessionId },
            body: {
              learningUnitId: targetUnit.id,
              prompt,
              transcript: spokenText,
              responseText: response.modelAnswer,
              feedback: {
                correctedText: response.correctedText,
                feedback: response.feedback,
                pronunciation: response.pronunciation,
                textSimilarity: response.textSimilarity
              },
              textSimilarity: response.textSimilarity,
              durationMs: 0
            }
          })
        }
        setTranscript('')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        setIsWorking(false)
      }
    },
    [
      addAttempt,
      capabilities,
      ensureSession,
      mode,
      prompt,
      queue,
      scenario,
      scenarioCefr,
      targetCefr,
      targetUnit,
      taskInstruction,
      turns
    ]
  )

  const stopRecording = async () => {
    setIsWorking(true)
    try {
      const recording = await recorder.stop()
      const activeSessionId = await ensureSession()
      const transcription = await ipcApi.request('speech.transcribe', {
        sessionId: activeSessionId,
        ...recording
      })
      setTranscript(transcription.text)
      await submitTranscript(transcription.text, recording)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      setIsWorking(false)
    }
  }

  const startRecording = async () => {
    try {
      await recorder.start()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const startRealtime = async () => {
    setIsWorking(true)
    try {
      stopRealtime()
      const activeSessionId = await ensureSession()
      const peer = new RTCPeerConnection()
      const remoteAudio = new Audio()
      remoteAudio.autoplay = true
      peer.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0]
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => peer.addTrack(track, stream))
      const dataChannel = peer.createDataChannel('oai-events')
      dataChannel.addEventListener('open', () => {
        dataChannel.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              turn_detection: { type: 'server_vad' }
            }
          })
        )
      })

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      if (!offer.sdp) throw new Error('Unable to create realtime WebRTC offer')

      const answer = await ipcApi.request('speech.realtime_sdp', {
        sessionId: activeSessionId,
        sdp: offer.sdp,
        instructions: realtimeInstructions,
        voice: 'marin'
      })
      await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
      realtimePeerRef.current = peer
      realtimeStreamRef.current = stream
      realtimeAudioRef.current = remoteAudio
      setIsRealtimeActive(true)
      setResult({ feedback: [t('english_learning.speaking.realtime_connected')] })
    } catch (error) {
      stopRealtime()
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIsWorking(false)
    }
  }

  const hearTarget = async () => {
    if (!targetUnit) return
    setIsWorking(true)
    try {
      const activeSessionId = await ensureSession()
      const speech = await ipcApi.request('speech.synthesize', {
        sessionId: activeSessionId,
        text: targetUnit.english
      })
      audioRef.current = await playBase64Audio(speech.audioBase64, speech.mediaType)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIsWorking(false)
    }
  }

  const complete = async () => {
    if (!sessionId) return
    await finishSession({ params: { id: sessionId }, body: { status: 'completed' } })
    setSessionId(null)
    setTurns([])
    setResult(null)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl">{t('english_learning.speaking.heading')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('english_learning.speaking.description')}</p>
        </div>
        <Badge variant="outline">
          {capabilities?.tier === 'realtime'
            ? t('english_learning.speaking.realtime')
            : capabilities?.tier === 'composed'
              ? t('english_learning.speaking.composed')
              : t('english_learning.speaking.text_only')}
        </Badge>
      </div>
      <Tabs value={mode} onValueChange={(value) => setMode(value as PracticeMode)}>
        <TabsList>
          <TabsTrigger value="scenario">{t('english_learning.speaking.mode.scenario')}</TabsTrigger>
          <TabsTrigger value="shadowing">{t('english_learning.speaking.mode.shadowing')}</TabsTrigger>
          <TabsTrigger value="spoken_recall">{t('english_learning.speaking.mode.spoken_recall')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="rounded-xl border border-border bg-card p-6">
        {mode === 'scenario' ? (
          <div className="space-y-3">
            <Input value={scenario} onChange={(event) => setScenario(event.target.value)} />
            <div className="rounded-lg bg-muted px-3 py-2 text-muted-foreground text-sm">
              <Badge variant="secondary" className="mr-2">
                {scenarioCefr}
              </Badge>
              {t(
                speakingTaskTranslationKeys[
                  getCardSpeakingTaskKey(mode, { cefr: scenarioCefr, english: '', meaning: '' })
                ]
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-muted-foreground text-xs uppercase">{t('english_learning.speaking.prompt')}</div>
            <div className="mt-3 font-medium text-2xl leading-relaxed">{prompt}</div>
            <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-muted-foreground text-sm">
              <Badge variant="secondary" className="mr-2">
                {targetCefr}
              </Badge>
              {taskLabel}
            </div>
            {mode === 'shadowing' && capabilities?.capabilities.synthesis ? (
              <Button variant="ghost" className="mt-3" onClick={() => void hearTarget()}>
                <Play className="size-4" />
                {t('english_learning.speaking.hear_target')}
              </Button>
            ) : null}
          </div>
        )}
        <Textarea.Input
          className="mt-5 min-h-28"
          value={transcript}
          onValueChange={setTranscript}
          placeholder={t('english_learning.speaking.transcript_placeholder')}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {capabilities?.capabilities.realtime ? (
            isRealtimeActive ? (
              <Button variant="destructive" onClick={stopRealtime}>
                <Square className="size-4" />
                {t('english_learning.speaking.stop_realtime')}
              </Button>
            ) : (
              <Button variant="default" disabled={isWorking} onClick={() => void startRealtime()}>
                <Mic className="size-4" />
                {t('english_learning.speaking.start_realtime')}
              </Button>
            )
          ) : null}
          {capabilities?.capabilities.transcription ? (
            recorder.isRecording ? (
              <Button variant="destructive" onClick={() => void stopRecording()}>
                <Square className="size-4" />
                {t('english_learning.speaking.stop')}
              </Button>
            ) : (
              <Button variant="outline" disabled={isWorking} onClick={() => void startRecording()}>
                <Mic className="size-4" />
                {t('english_learning.speaking.record')}
              </Button>
            )
          ) : null}
          <Button disabled={isWorking || !transcript.trim()} onClick={() => void submitTranscript(transcript)}>
            {t('english_learning.speaking.send')}
          </Button>
          {sessionId ? (
            <Button variant="ghost" onClick={() => void complete()}>
              <StopCircle className="size-4" />
              {t('english_learning.speaking.finish')}
            </Button>
          ) : null}
        </div>
        {!capabilities?.capabilities.realtime ? (
          <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-muted-foreground text-sm">
            {t('english_learning.speaking.realtime_unavailable_hint')}
          </div>
        ) : null}
      </div>
      {result ? (
        <div className="rounded-xl border border-info-border bg-info-subtle p-5 text-info-subtle-foreground">
          {result.reply ? <div className="font-medium text-lg">{result.reply}</div> : null}
          {result.pronunciation ? (
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                {t('english_learning.speaking.pronunciation')}: {result.pronunciation.pronunciation}
              </div>
              <div>
                {t('english_learning.speaking.stress')}: {result.pronunciation.stress}
              </div>
              <div>
                {t('english_learning.speaking.intonation')}: {result.pronunciation.intonation}
              </div>
              <div>
                {t('english_learning.speaking.pace')}: {result.pronunciation.pace}
              </div>
              <div className="text-muted-foreground sm:col-span-2">
                {result.pronunciation.source === 'audio'
                  ? t('english_learning.speaking.audio_diagnosis')
                  : t('english_learning.speaking.transcript_only_diagnosis')}
              </div>
            </div>
          ) : null}
          {result.feedback.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {result.feedback.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
