import { Badge, Button, Input, Tabs, TabsList, TabsTrigger, Textarea } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { ResolvedSpeechCapabilities, ScenarioTurn } from '@shared/ai/speech'
import type { PracticeMode } from '@shared/data/types/englishLearning'
import { Mic, Play, Square, StopCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSpeechRecorder } from './useSpeechRecorder'

function playBase64Audio(audioBase64: string, mediaType: string): void {
  const audio = new Audio(`data:${mediaType};base64,${audioBase64}`)
  void audio.play()
}

export function SpeakingPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<PracticeMode>('scenario')
  const [capabilities, setCapabilities] = useState<ResolvedSpeechCapabilities | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [scenario, setScenario] = useState(t('english_learning.speaking.default_scenario'))
  const [result, setResult] = useState<{ reply?: string; feedback: string[] } | null>(null)
  const [turns, setTurns] = useState<ScenarioTurn[]>([])
  const [isWorking, setIsWorking] = useState(false)
  const sessionIdRef = useRef<string | null>(null)
  const recorder = useSpeechRecorder()
  const { data: queue } = useQuery('/english-learning/reviews/today', { query: { limit: 10 } })
  const { trigger: createSession } = useMutation('POST', '/english-learning/practice/sessions')
  const { trigger: addAttempt } = useMutation('POST', '/english-learning/practice/sessions/:id/attempts')
  const { trigger: finishSession } = useMutation('PATCH', '/english-learning/practice/sessions/:id')
  const targetUnit = queue?.items[0]?.unit

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
      const activeSessionId = sessionIdRef.current
      if (activeSessionId) {
        void ipcApi.request('speech.cancel', { sessionId: activeSessionId })
        void finishSession({ params: { id: activeSessionId }, body: { status: 'interrupted' } })
      }
    },
    [finishSession]
  )

  const prompt = useMemo(() => {
    if (mode === 'scenario') return scenario
    if (!targetUnit) return t('english_learning.speaking.no_target')
    return mode === 'shadowing' ? targetUnit.english : targetUnit.meaning
  }, [mode, scenario, t, targetUnit])

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
    async (spokenText: string) => {
      if (!spokenText.trim()) return
      setIsWorking(true)
      try {
        const activeSessionId = await ensureSession()
        if (mode === 'scenario') {
          const response = await ipcApi.request('speech.scenario_reply', {
            sessionId: activeSessionId,
            scenario,
            cefr: 'B2',
            targets: queue?.items.slice(0, 8).map((item) => item.unit.english) ?? [],
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
            playBase64Audio(speech.audioBase64, speech.mediaType)
          }
        } else if (targetUnit) {
          const response = await ipcApi.request('speech.evaluate', {
            sessionId: activeSessionId,
            mode,
            target: targetUnit.english,
            meaning: targetUnit.meaning,
            transcript: spokenText
          })
          setResult({ reply: response.correctedText, feedback: response.feedback })
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
    [addAttempt, capabilities, ensureSession, mode, prompt, queue, scenario, targetUnit, turns]
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
      await submitTranscript(transcription.text)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      setIsWorking(false)
    }
  }

  const hearTarget = async () => {
    if (!targetUnit) return
    const activeSessionId = await ensureSession()
    const speech = await ipcApi.request('speech.synthesize', {
      sessionId: activeSessionId,
      text: targetUnit.english
    })
    playBase64Audio(speech.audioBase64, speech.mediaType)
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
          {capabilities?.tier === 'composed'
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
          <Input value={scenario} onChange={(event) => setScenario(event.target.value)} />
        ) : (
          <div>
            <div className="text-muted-foreground text-xs uppercase">{t('english_learning.speaking.prompt')}</div>
            <div className="mt-3 font-medium text-2xl leading-relaxed">{prompt}</div>
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
          {capabilities?.capabilities.transcription ? (
            recorder.isRecording ? (
              <Button variant="destructive" onClick={() => void stopRecording()}>
                <Square className="size-4" />
                {t('english_learning.speaking.stop')}
              </Button>
            ) : (
              <Button variant="outline" disabled={isWorking} onClick={() => void recorder.start()}>
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
      </div>
      {result ? (
        <div className="rounded-xl border border-info-border bg-info-subtle p-5 text-info-subtle-foreground">
          {result.reply ? <div className="font-medium text-lg">{result.reply}</div> : null}
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
