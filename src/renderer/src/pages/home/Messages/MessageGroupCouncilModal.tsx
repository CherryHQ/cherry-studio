import { loggerService } from '@logger'
import { fetchGenerate } from '@renderer/services/ApiService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import { saveMessageAndBlocksToDB } from '@renderer/store/thunk/messageThunk'
import type { Model, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'
import { createAssistantMessage, createMainTextBlock } from '@renderer/utils/messageUtils/create'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { Alert, Button, Collapse, Divider, List, Modal, Select, Space, Table, Tabs, Tag, Typography } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type Stage1Candidate = {
  messageId: string
  model: Model
  modelLabel: string
  response: string
}

type Stage2Result = {
  model: Model
  modelLabel: string
  ranking: string
  parsedRanking: string[]
  scorecard: Scorecard
}

type AggregateRanking = {
  model: string
  average_rank: number
  rankings_count: number
}

type ScoreEntry = {
  Accuracy?: number
  Reasoning?: number
  Coverage?: number
  Actionability?: number
  Grounding?: number
  HallucinationRisk?: number
}

type Scorecard = Record<string, ScoreEntry>

interface Props {
  open: boolean
  onClose: () => void
  messages: Message[]
  topic: Topic
  autoRun?: boolean
}

const logger = loggerService.withContext('MessageGroupCouncilModal')

const BASE_SYSTEM_PROMPT = 'You are a helpful assistant.'

const getChairmanStorageKey = (topicId: string) => `llm-committee-chairman:${topicId}`

const getModelLabel = (model: Model | undefined, fallback?: string) => {
  if (model?.name) return model.name
  if (model?.id) return model.id
  return fallback || ''
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const formatDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.round(ms / 100) / 10)
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round((totalSeconds - minutes * 60) * 10) / 10
  return `${minutes}m ${seconds.toFixed(1)}s`
}

const isTransmitting = (message: Message) => {
  if (message.role !== 'assistant') return false
  const status = (message.status || '').toString().toLowerCase()
  return status === 'processing' || status === 'pending' || status === 'searching'
}

const parseRankingFromText = (rankingText: string): string[] => {
  if (!rankingText) return []
  if (rankingText.includes('FINAL RANKING:')) {
    const parts = rankingText.split('FINAL RANKING:')
    if (parts.length >= 2) {
      const rankingSection = parts[1]
      const numbered = rankingSection.match(/\d+\.\s*Response [A-Z]/g)
      if (numbered?.length) {
        return numbered.map((item) => item.match(/Response [A-Z]/)?.[0]).filter(Boolean) as string[]
      }
      const matches = rankingSection.match(/Response [A-Z]/g)
      if (matches) return matches
    }
  }
  const fallback = rankingText.match(/Response [A-Z]/g)
  return fallback || []
}

const parseScorecardFromText = (rankingText: string): Scorecard => {
  const scorecard: Scorecard = {}
  if (!rankingText) return scorecard

  let inScorecard = false
  const lines = rankingText.split(/\r?\n/)
  const linePattern =
    /Response\s+([A-Z])\s*\|\s*Accuracy\s*:\s*(\d+(?:\.\d+)?)\s*\|\s*Reasoning\s*:\s*(\d+(?:\.\d+)?)\s*\|\s*Coverage\s*:\s*(\d+(?:\.\d+)?)\s*\|\s*Actionability\s*:\s*(\d+(?:\.\d+)?)\s*\|\s*Grounding\s*:\s*(\d+(?:\.\d+)?)\s*\|\s*HallucinationRisk\s*:\s*(\d+(?:\.\d+)?)/i

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      if (inScorecard && Object.keys(scorecard).length > 0) break
      continue
    }

    if (line.toUpperCase() === 'SCORECARD:') {
      inScorecard = true
      continue
    }

    if (!inScorecard) continue
    if (line.toUpperCase().startsWith('FINAL RANKING')) break

    const match = line.match(linePattern)
    if (!match) continue

    const label = `Response ${match[1]}`
    scorecard[label] = {
      Accuracy: Number(match[2]),
      Reasoning: Number(match[3]),
      Coverage: Number(match[4]),
      Actionability: Number(match[5]),
      Grounding: Number(match[6]),
      HallucinationRisk: Number(match[7])
    }
  }

  return scorecard
}

const calculateAggregateRankings = (
  stage2Results: Stage2Result[],
  labelToModel: Record<string, string>
): AggregateRanking[] => {
  const positions = new Map<string, number[]>()
  stage2Results.forEach((result) => {
    result.parsedRanking.forEach((label, index) => {
      const modelName = labelToModel[label]
      if (!modelName) return
      if (!positions.has(modelName)) {
        positions.set(modelName, [])
      }
      positions.get(modelName)?.push(index + 1)
    })
  })

  const aggregate = Array.from(positions.entries()).map(([model, ranks]) => {
    const avgRank = ranks.reduce((sum, value) => sum + value, 0) / ranks.length
    return {
      model,
      average_rank: Math.round(avgRank * 100) / 100,
      rankings_count: ranks.length
    }
  })

  aggregate.sort((a, b) => a.average_rank - b.average_rank)
  return aggregate
}

const buildStage2Prompt = (question: string, stage1Ordered: Stage1Candidate[], labels: string[]) => {
  const responsesText = stage1Ordered
    .map((result, index) => `Response ${labels[index]}:\n${result.response}`)
    .join('\n\n')

  return (
    `You are evaluating different responses to the following question:\n\n` +
    `Question: ${question}\n\n` +
    `Here are the responses from different models (anonymized):\n\n` +
    `${responsesText}\n\n` +
    `Your task:\n` +
    `1. Provide a SCORECARD section first, using the exact format below and scores from 1-10.\n` +
    `SCORECARD:\n` +
    `Response A | Accuracy: 1 | Reasoning: 1 | Coverage: 1 | Actionability: 1 | Grounding: 1 | HallucinationRisk: 1\n` +
    `Response B | Accuracy: 1 | Reasoning: 1 | Coverage: 1 | Actionability: 1 | Grounding: 1 | HallucinationRisk: 1\n` +
    `2. Then evaluate each response individually. For each response, explain what it does well and what it does poorly.\n` +
    `3. Then, at the very end of your response, provide a final ranking.\n\n` +
    `IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:\n` +
    `- Start with the line "FINAL RANKING:" (all caps, with colon)\n` +
    `- Then list the responses from best to worst as a numbered list\n` +
    `- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")\n` +
    `- Do not add any other text or explanations in the ranking section\n\n` +
    `Now provide your evaluation and ranking:`
  )
}

const buildStage3Prompt = (question: string, stage1Ordered: Stage1Candidate[], stage2Ordered: Stage2Result[]) => {
  const stage1Text = stage1Ordered
    .map((result) => `Model: ${result.modelLabel}\nResponse: ${result.response}`)
    .join('\n\n')
  const stage2Text = stage2Ordered
    .map((result) => `Model: ${result.modelLabel}\nRanking: ${result.ranking}`)
    .join('\n\n')

  return (
    `You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.\n\n` +
    `Original Question: ${question}\n\n` +
    `STAGE 1 - Individual Responses:\n${stage1Text}\n\n` +
    `STAGE 2 - Peer Rankings:\n${stage2Text}\n\n` +
    `Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:\n` +
    `- The individual responses and their insights\n` +
    `- The peer rankings and what they reveal about response quality\n` +
    `- Any patterns of agreement or disagreement\n\n` +
    `Provide a clear, well-reasoned final answer that represents the council's collective wisdom:`
  )
}

const deAnonymizeText = (text: string, labelToModel: Record<string, string>) => {
  if (!text) return ''
  let result = text
  Object.entries(labelToModel).forEach(([label, model]) => {
    const safeLabel = escapeRegExp(label)
    result = result.replace(new RegExp(safeLabel, 'g'), `${label} (${model})`)
  })
  return result
}

const MessageGroupCouncilModal: FC<Props> = ({ open, onClose, messages, topic, autoRun }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const askId = messages[0]?.askId
  const questionMessage = useAppSelector((state) => (askId ? state.messages.entities[askId] : undefined))
  const question = useMemo(() => (questionMessage ? getMainTextContent(questionMessage).trim() : ''), [questionMessage])

  const stage1Candidates = useMemo<Stage1Candidate[]>(() => {
    return messages
      .filter((message) => {
        if (message.role !== 'assistant') return false
        if (message.type === 'committee') return false
        const status = (message.status || '').toString().toLowerCase()
        if (status === 'processing' || status === 'pending' || status === 'searching') {
          return false
        }
        const content = getMainTextContent(message).trim()
        return !!content && !!message.model
      })
      .map((message) => ({
        messageId: message.id,
        model: message.model as Model,
        modelLabel: getModelLabel(message.model, message.modelId),
        response: getMainTextContent(message).trim()
      }))
  }, [messages])

  const [chairmanModelId, setChairmanModelId] = useState<string | undefined>(() => {
    const cached = window.localStorage.getItem(getChairmanStorageKey(topic.id))
    return cached || stage1Candidates[0]?.model.id
  })

  const [running, setRunning] = useState(false)
  const [stageStatus, setStageStatus] = useState<'idle' | 'stage2' | 'stage3' | 'complete'>('idle')
  const [stage2Results, setStage2Results] = useState<Stage2Result[]>([])
  const [stage3Result, setStage3Result] = useState('')
  const [labelToModel, setLabelToModel] = useState<Record<string, string>>({})
  const [aggregateRankings, setAggregateRankings] = useState<AggregateRanking[]>([])
  const [appendedMessageId, setAppendedMessageId] = useState<string | null>(null)
  const [stage2StartedAt, setStage2StartedAt] = useState<number | null>(null)
  const [stage3StartedAt, setStage3StartedAt] = useState<number | null>(null)
  const [stage2DurationMs, setStage2DurationMs] = useState<number | null>(null)
  const [stage3DurationMs, setStage3DurationMs] = useState<number | null>(null)
  const [timerTick, setTimerTick] = useState(0)
  const autoRunRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    const availableIds = new Set(stage1Candidates.map((candidate) => candidate.model.id))
    if (chairmanModelId && availableIds.has(chairmanModelId)) return
    const fallback = stage1Candidates[0]?.model.id
    if (fallback) {
      setChairmanModelId(fallback)
    }
  }, [open, stage1Candidates, chairmanModelId])

  const chairmanModel = useMemo(
    () => stage1Candidates.find((candidate) => candidate.model.id === chairmanModelId)?.model,
    [stage1Candidates, chairmanModelId]
  )

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setTimerTick(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [running])

  const stage2ElapsedText = useMemo(() => {
    if (!stage2StartedAt && stage2DurationMs === null) return ''
    const now = timerTick || Date.now()
    const elapsedMs = stage2DurationMs ?? Math.max(0, now - (stage2StartedAt ?? now))
    const label = formatDuration(elapsedMs)
    return stage2DurationMs !== null
      ? t('message.committee.elapsed', { time: label })
      : t('message.committee.elapsed_running', { time: label })
  }, [stage2DurationMs, stage2StartedAt, t, timerTick])

  const stage3ElapsedText = useMemo(() => {
    if (!stage3StartedAt && stage3DurationMs === null) return ''
    const now = timerTick || Date.now()
    const elapsedMs = stage3DurationMs ?? Math.max(0, now - (stage3StartedAt ?? now))
    const label = formatDuration(elapsedMs)
    return stage3DurationMs !== null
      ? t('message.committee.elapsed', { time: label })
      : t('message.committee.elapsed_running', { time: label })
  }, [stage3DurationMs, stage3StartedAt, t, timerTick])

  const handleChairmanChange = (value: string) => {
    setChairmanModelId(value)
    window.localStorage.setItem(getChairmanStorageKey(topic.id), value)
  }

  const appendStage3Message = useCallback(
    async (content: string, model: Model) => {
      const assistantId = messages[0]?.assistantId
      if (!assistantId) {
        throw new Error('Missing assistantId for committee message')
      }

      const committeeMessage = createAssistantMessage(assistantId, topic.id, {
        askId,
        model,
        modelId: model.id,
        status: AssistantMessageStatus.SUCCESS
      })
      committeeMessage.type = 'committee'

      const textBlock = createMainTextBlock(committeeMessage.id, content, {
        status: MessageBlockStatus.SUCCESS
      })
      committeeMessage.blocks = [textBlock.id]

      dispatch(upsertOneBlock(textBlock))
      dispatch(newMessagesActions.addMessage({ topicId: topic.id, message: committeeMessage }))
      await saveMessageAndBlocksToDB(committeeMessage, [textBlock])
      setAppendedMessageId(committeeMessage.id)
      window.toast.success(t('message.committee.appended'))
    },
    [askId, dispatch, messages, t, topic.id]
  )

  const runStage3 = useCallback(
    async (stage2Override?: Stage2Result[], options?: { manageRunning?: boolean }) => {
      const manageRunning = options?.manageRunning ?? true

      if (manageRunning && running) return
      if (!question) {
        window.toast.warning(t('message.committee.warning.no_question'))
        return
      }
      if (stage1Candidates.length < 2) {
        window.toast.warning(t('message.committee.warning.no_responses'))
        return
      }

      const stage2 = stage2Override ?? stage2Results
      if (stage2.length === 0) {
        window.toast.warning(t('message.committee.warning.no_responses'))
        return
      }

      if (manageRunning) {
        setRunning(true)
      }

      setStageStatus('stage3')
      setStage3Result('')
      setAppendedMessageId(null)
      setStage3DurationMs(null)

      try {
        const stage3Start = Date.now()
        setStage3StartedAt(stage3Start)
        setTimerTick(stage3Start)

        const chairman = chairmanModel || stage1Candidates[0]?.model
        if (!chairman) {
          window.toast.error(t('message.committee.error'))
          setStageStatus('idle')
          return
        }

        const stage3Prompt = buildStage3Prompt(question, stage1Candidates, stage2)
        const stage3Text = await fetchGenerate({
          prompt: BASE_SYSTEM_PROMPT,
          content: stage3Prompt,
          model: chairman
        })
        setStage3Result(stage3Text)
        setStage3DurationMs(Date.now() - stage3Start)
        setStage3StartedAt(null)

        if (stage3Text.trim()) {
          setStageStatus('complete')
          await appendStage3Message(stage3Text, chairman)
        } else {
          setStageStatus('idle')
          window.toast.error(t('message.committee.error'))
        }
      } catch (error) {
        logger.error('Stage3 synthesis failed', error as Error)
        window.toast.error(t('message.committee.error'))
        setStageStatus('idle')
      } finally {
        if (manageRunning) {
          setRunning(false)
        }
      }
    },
    [appendStage3Message, chairmanModel, question, running, stage1Candidates, stage2Results, t]
  )

  const runCouncil = useCallback(async () => {
    if (running) return
    if (!question) {
      window.toast.warning(t('message.committee.warning.no_question'))
      return
    }
    if (stage1Candidates.length < 2) {
      window.toast.warning(t('message.committee.warning.no_responses'))
      return
    }

    setRunning(true)
    setStageStatus('stage2')
    setStage2Results([])
    setStage3Result('')
    setAggregateRankings([])
    setAppendedMessageId(null)
    setStage2DurationMs(null)
    setStage3DurationMs(null)

    try {
      const labels = stage1Candidates.map((_, index) => String.fromCharCode(65 + index))
      const labelMap = labels.reduce<Record<string, string>>((acc, label, index) => {
        acc[`Response ${label}`] = stage1Candidates[index].modelLabel
        return acc
      }, {})
      setLabelToModel(labelMap)

      const stage2Start = Date.now()
      setStage2StartedAt(stage2Start)
      setStage3StartedAt(null)
      setTimerTick(stage2Start)

      const stage2Prompt = buildStage2Prompt(question, stage1Candidates, labels)
      const stage2Raw = await Promise.all(
        stage1Candidates.map(async (candidate) => {
          try {
            const ranking = await fetchGenerate({
              prompt: BASE_SYSTEM_PROMPT,
              content: stage2Prompt,
              model: candidate.model
            })
            return {
              model: candidate.model,
              modelLabel: candidate.modelLabel,
              ranking,
              parsedRanking: parseRankingFromText(ranking),
              scorecard: parseScorecardFromText(ranking)
            }
          } catch (error) {
            logger.error('Stage2 ranking failed', error as Error)
            return {
              model: candidate.model,
              modelLabel: candidate.modelLabel,
              ranking: '',
              parsedRanking: [],
              scorecard: {}
            }
          }
        })
      )
      const stage2 = stage2Raw.filter((result) => result.ranking.trim().length > 0)

      setStage2DurationMs(Date.now() - stage2Start)
      setStage2StartedAt(null)
      setStage2Results(stage2)
      const aggregate = calculateAggregateRankings(stage2, labelMap)
      setAggregateRankings(aggregate)

      await runStage3(stage2, { manageRunning: false })
    } catch (error) {
      logger.error('LLM committee failed', error as Error)
      window.toast.error(t('message.committee.error'))
      setStageStatus('idle')
    } finally {
      setRunning(false)
    }
  }, [question, runStage3, running, stage1Candidates, t])

  useEffect(() => {
    if (!open || !autoRun) return
    if (!askId) return
    if (autoRunRef.current === askId) return
    if (running) return
    if (stage2Results.length > 0 || stage3Result) {
      autoRunRef.current = askId
      return
    }
    if (messages.some(isTransmitting)) return
    if (stage1Candidates.length < 2) return

    autoRunRef.current = askId
    runCouncil()
  }, [askId, autoRun, messages, open, runCouncil, running, stage1Candidates.length, stage2Results.length, stage3Result])

  const statusLabel = useMemo(() => {
    if (stageStatus === 'stage2') return t('message.committee.status.stage2')
    if (stageStatus === 'stage3') return t('message.committee.status.stage3')
    if (stageStatus === 'complete') return t('message.committee.status.complete')
    return ''
  }, [stageStatus, t])

  const stage2Tabs = useMemo(() => {
    return stage2Results.map((result, index) => ({
      key: String(index),
      label: result.modelLabel,
      children: (
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          {Object.keys(result.scorecard).length > 0 && (
            <div>
              <Typography.Text strong>{t('message.committee.scorecard.title')}</Typography.Text>
              <Table
                size="small"
                pagination={false}
                style={{ marginTop: 8 }}
                columns={[
                  {
                    title: t('message.committee.scorecard.response'),
                    dataIndex: 'response',
                    key: 'response'
                  },
                  {
                    title: t('message.committee.scorecard.accuracy'),
                    dataIndex: 'accuracy',
                    key: 'accuracy',
                    align: 'center'
                  },
                  {
                    title: t('message.committee.scorecard.reasoning'),
                    dataIndex: 'reasoning',
                    key: 'reasoning',
                    align: 'center'
                  },
                  {
                    title: t('message.committee.scorecard.coverage'),
                    dataIndex: 'coverage',
                    key: 'coverage',
                    align: 'center'
                  },
                  {
                    title: t('message.committee.scorecard.actionability'),
                    dataIndex: 'actionability',
                    key: 'actionability',
                    align: 'center'
                  },
                  {
                    title: t('message.committee.scorecard.grounding'),
                    dataIndex: 'grounding',
                    key: 'grounding',
                    align: 'center'
                  },
                  {
                    title: t('message.committee.scorecard.hallucination'),
                    dataIndex: 'hallucination',
                    key: 'hallucination',
                    align: 'center'
                  }
                ]}
                dataSource={Object.entries(result.scorecard).map(([label, scores]) => ({
                  key: label,
                  response: labelToModel[label] ? `${labelToModel[label]} (${label})` : label,
                  accuracy: scores.Accuracy ?? '-',
                  reasoning: scores.Reasoning ?? '-',
                  coverage: scores.Coverage ?? '-',
                  actionability: scores.Actionability ?? '-',
                  grounding: scores.Grounding ?? '-',
                  hallucination: scores.HallucinationRisk ?? '-'
                }))}
              />
            </div>
          )}
          <StageText>{deAnonymizeText(result.ranking, labelToModel)}</StageText>
          {result.parsedRanking.length > 0 && (
            <div>
              <Typography.Text strong>{t('message.committee.parsed')}</Typography.Text>
              <ol>
                {result.parsedRanking.map((label, index) => (
                  <li key={`${label}-${index}`}>{labelToModel[label] || label}</li>
                ))}
              </ol>
            </div>
          )}
        </Space>
      )
    }))
  }, [labelToModel, stage2Results, t])

  const showStage3Retry = useMemo(() => {
    return stage2Results.length > 0 && !running && stage3Result.trim().length === 0
  }, [running, stage2Results.length, stage3Result])

  return (
    <Modal
      title={t('message.committee.title')}
      open={open}
      onCancel={onClose}
      footer={null}
      width={860}
      centered>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space align="center" wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space align="center" wrap>
            <Typography.Text>{t('message.committee.chairman')}</Typography.Text>
            <Select
              style={{ minWidth: 240 }}
              placeholder={t('message.committee.chairman_placeholder')}
              value={chairmanModelId}
              onChange={handleChairmanChange}
              options={stage1Candidates.map((candidate) => ({
                label: candidate.modelLabel,
                value: candidate.model.id
              }))}
              optionFilterProp="label"
              showSearch
            />
            <Button type="primary" onClick={runCouncil} loading={running}>
              {stage2Results.length > 0 || stage3Result ? t('message.committee.rerun') : t('message.committee.run')}
            </Button>
          </Space>
          {statusLabel && <Tag color={stageStatus === 'complete' ? 'green' : 'blue'}>{statusLabel}</Tag>}
        </Space>

        {appendedMessageId && <Alert type="success" message={t('message.committee.appended')} showIcon />}

        <SectionTitle level={5}>{t('message.committee.stage1')}</SectionTitle>
        {stage1Candidates.length > 0 ? (
          <Collapse
            size="small"
            items={stage1Candidates.map((candidate) => ({
              key: candidate.messageId,
              label: candidate.modelLabel,
              children: <StageText>{candidate.response}</StageText>
            }))}
          />
        ) : (
          <Typography.Text type="secondary">{t('message.committee.empty.stage1')}</Typography.Text>
        )}

        <Divider />

        <StageHeader>
          <SectionTitle level={5}>{t('message.committee.stage2')}</SectionTitle>
          {stage2ElapsedText && <ElapsedText type="secondary">{stage2ElapsedText}</ElapsedText>}
        </StageHeader>
        {stage2Results.length > 0 ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {aggregateRankings.length > 0 && (
              <div>
                <Typography.Text strong>{t('message.committee.aggregate')}</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  {t('message.committee.aggregate_desc')}
                </Typography.Paragraph>
                <List
                  size="small"
                  dataSource={aggregateRankings}
                  renderItem={(item, index) => (
                    <List.Item>
                      <Space>
                        <Tag color="blue">#{index + 1}</Tag>
                        <span>{item.model}</span>
                        <Typography.Text type="secondary">
                          {item.average_rank.toFixed(2)} / {item.rankings_count}
                        </Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </div>
            )}
            <Tabs items={stage2Tabs} />
          </Space>
        ) : (
          <Typography.Text type="secondary">{t('message.committee.empty.stage2')}</Typography.Text>
        )}

        <Divider />

        <StageHeader>
          <SectionTitle level={5}>{t('message.committee.stage3')}</SectionTitle>
          {stage3ElapsedText && <ElapsedText type="secondary">{stage3ElapsedText}</ElapsedText>}
          {showStage3Retry && (
            <Button size="small" onClick={() => runStage3()}>
              {t('message.committee.stage3_retry')}
            </Button>
          )}
        </StageHeader>
        {stage3Result ? (
          <StageText>{stage3Result}</StageText>
        ) : (
          <Typography.Text type="secondary">{t('message.committee.empty.stage3')}</Typography.Text>
        )}
      </Space>
    </Modal>
  )
}

const SectionTitle = styled(Typography.Title)`
  margin: 0;
`

const StageHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const ElapsedText = styled(Typography.Text)`
  font-size: 12px;
`

const StageText = styled.div`
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px 12px;
  max-height: 260px;
  overflow-y: auto;
`

export default MessageGroupCouncilModal
