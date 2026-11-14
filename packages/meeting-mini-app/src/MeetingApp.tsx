import { Button, Input, Markdown, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@cherrystudio/ui'
import {
  AlignLeft,
  CalendarDays,
  Download,
  FileJson,
  FileText,
  History,
  LoaderCircle,
  LogOut,
  Network,
  Plus,
  Sparkles,
  Square,
  Trash2
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type Access, assertAccess, refreshAccess, verifyAccessToken } from './access'
import { translations } from './i18n'
import {
  encodeText,
  importMeeting,
  loadMeetings,
  type Meeting,
  meetingMarkdown,
  parseMindMap,
  saveMeeting
} from './meeting'
import { MeetingClient } from './meetingClient'
import MeetingMindMapView from './MeetingMindMapView'
import { MeetingSummaryView } from './MeetingSummaryView'
import { transcriptParagraphs } from './transcript'

function messageKey(error: unknown): string {
  const key = error instanceof Error ? error.message : ''
  return Object.hasOwn(translations.en.translation, key) ? key : 'error'
}

export function MeetingApp() {
  const { t } = useTranslation()
  const [access, setAccess] = useState<Access | null>(null)
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const expire = (reason = 'accessExpired') => {
    if (access) {
      access.revoked = true
      access.token = ''
    }
    setAccess(null)
    setToken('')
    setError(reason)
  }

  useEffect(() => {
    if (!access) return
    let disposed = false
    let checking = false
    let visible = true
    const check = async () => {
      if (checking || !visible) return
      checking = true
      try {
        await refreshAccess(access)
      } catch (cause) {
        if (!disposed) {
          setAccess(null)
          setToken('')
          setError(messageKey(cause))
        }
      } finally {
        checking = false
      }
    }
    const timer = setInterval(() => void check(), 60_000)
    const off = window.cherry.on('app.visibilityChange', ({ visible: next }) => {
      visible = next
      if (visible) void check()
    })
    return () => {
      disposed = true
      clearInterval(timer)
      off()
    }
  }, [access])

  if (access)
    return (
      <Workspace
        access={access}
        onExpired={expire}
        onExit={() => {
          access.revoked = true
          access.token = ''
          setAccess(null)
          setError('')
        }}
      />
    )
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div
        className="w-full max-w-md space-y-5"
        role="form"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.currentTarget.querySelector<HTMLButtonElement>('button')?.click()
          }
        }}>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('tokenHelp')}</p>
        <label className="block space-y-2">
          <span>{t('token')}</span>
          <Input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            maxLength={4096}
            autoComplete="off"
            spellCheck={false}
            required
            disabled={verifying}
          />
        </label>
        {error ? (
          <p role="alert" className="text-error">
            {t(error)}
          </p>
        ) : null}
        <Button
          type="button"
          loading={verifying}
          disabled={verifying || !token.trim()}
          onClick={async () => {
            setVerifying(true)
            setError('')
            try {
              setAccess(await verifyAccessToken(token))
            } catch (cause) {
              setError(messageKey(cause))
            } finally {
              setToken('')
              setVerifying(false)
            }
          }}>
          {t('unlock')}
        </Button>
      </div>
    </main>
  )
}

function Workspace({
  access,
  onExit,
  onExpired
}: {
  access: Access
  onExit: () => void
  onExpired: (reason?: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [selected, setSelected] = useState<Meeting | null>(null)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [visible, setVisible] = useState(true)
  const visibleRef = useRef(true)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  function report(cause: unknown) {
    if (!mounted.current) return
    if (cause instanceof Error && ['accessExpired', 'authUnavailable'].includes(cause.message)) onExpired(cause.message)
    else setError(messageKey(cause))
  }

  async function reload() {
    setLoading(true)
    setError('')
    try {
      assertAccess(access)
      const rows = await loadMeetings()
      if (mounted.current) setMeetings(rows)
    } catch (cause) {
      report(cause)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    void reload()
    const off = window.cherry.on('app.visibilityChange', ({ visible: next }) => {
      visibleRef.current = next
      setVisible(next)
    })
    return () => {
      mounted.current = false
      controller.current?.abort()
      off()
    }
    // Each workspace is mounted for one verified access grant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function persist(meeting: Meeting) {
    assertAccess(access)
    await saveMeeting(meeting)
    if (!mounted.current) return
    setMeetings((rows) =>
      [meeting, ...rows.filter((row) => row.id !== meeting.id)].sort((a, b) => b.createdAt - a.createdAt)
    )
    setSelected(meeting)
  }

  async function act(action: () => Promise<void>) {
    setError('')
    setBusy(true)
    try {
      assertAccess(access)
      await action()
    } catch (cause) {
      report(cause)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  async function generate(meeting: Meeting, visualOnly = false) {
    const abort = new AbortController()
    controller.current = abort
    setRunning(true)
    setError('')
    const client = new MeetingClient(access)
    let current = meeting
    const deadline = Date.now() + 10 * 60_000
    try {
      if (!current.taskId) {
        current = { ...current, taskId: await client.submit(current, abort.signal) }
        await persist(current)
      }
      while (!visualOnly && !abort.signal.aborted && (!current.summary || !current.mindMap.length)) {
        if (Date.now() > deadline) throw new Error('expiredJob')
        assertAccess(access)
        if (visibleRef.current) {
          const next = await client.step(current, abort.signal)
          if (next !== current) {
            await persist(next)
            current = next
          }
        }
        if (current.summary && current.mindMap.length) break
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer)
            abort.signal.removeEventListener('abort', done)
            resolve()
          }
          const timer = setTimeout(done, 4000)
          abort.signal.addEventListener('abort', done, { once: true })
          if (abort.signal.aborted) done()
        })
      }
      if (current.taskId && current.summary && !current.summaryHtml && !abort.signal.aborted) {
        let start = true
        while (!abort.signal.aborted) {
          if (Date.now() > deadline) throw new Error('expiredJob')
          if (visibleRef.current) {
            const html = await client.visualSummary(current.taskId, abort.signal, start)
            start = false
            if (html) {
              await persist({ ...current, summaryHtml: html })
              break
            }
          }
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer)
              abort.signal.removeEventListener('abort', done)
              resolve()
            }
            const timer = setTimeout(done, 4000)
            abort.signal.addEventListener('abort', done, { once: true })
            if (abort.signal.aborted) done()
          })
        }
      }
    } catch (cause) {
      if (!abort.signal.aborted) report(cause)
    } finally {
      if (mounted.current) setRunning(false)
      controller.current = null
    }
  }

  const disabled = busy || running || loading
  const paragraphs = selected ? transcriptParagraphs(selected.text) : []
  const reset = () => {
    setSelected(null)
    setTitle('')
    setText('')
    setError('')
    setDeleting(false)
  }
  const date = (value: number) => new Date(value).toLocaleDateString(i18n.language)
  const complete = Boolean(selected?.summary && selected.mindMap.length && selected.summaryHtml)
  return (
    <main className="meeting-layout">
      <aside className="meeting-history">
        <div className="meeting-history-heading">
          <h2>
            <History className="size-4" />
            {t('history')}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={reset}
            aria-label={t('newMeeting')}
            title={t('newMeeting')}>
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="meeting-history-list">
          {loading ? (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              {t('loading')}
            </p>
          ) : null}
          {!loading && !meetings.length ? (
            <p className="p-4 text-sm text-muted-foreground">{t('historyEmpty')}</p>
          ) : null}
          {meetings.map((meeting) => (
            <Button
              key={meeting.id}
              variant="ghost"
              className="meeting-history-item"
              aria-pressed={selected?.id === meeting.id}
              disabled={disabled}
              onClick={() => {
                setSelected(meeting)
                setDeleting(false)
                setError('')
              }}>
              <span className="meeting-history-name">{meeting.title}</span>
              <span className="meeting-history-meta">
                <span>{date(meeting.createdAt)}</span>
                <span>{t(meeting.summary ? 'organized' : 'pending')}</span>
              </span>
            </Button>
          ))}
        </div>
        <div className="meeting-history-footer">
          <Button variant="ghost" className="w-full justify-start" onClick={onExit}>
            <LogOut className="size-4" />
            {t('logout')}
          </Button>
        </div>
      </aside>
      <div className="meeting-main">
        <header className="meeting-heading">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{selected?.title ?? t('title')}</h1>
              {selected ? (
                <span className={`meeting-status ${running ? 'is-running' : ''}`}>
                  {running ? <LoaderCircle className="size-3 animate-spin" /> : <FileText className="size-3" />}
                  {t(running ? 'working' : selected.summary ? 'organized' : 'pending')}
                </span>
              ) : null}
            </div>
            {selected ? (
              <div className="meeting-meta">
                <span>
                  <CalendarDays className="size-3" />
                  {date(selected.createdAt)}
                </span>
                <span>
                  <AlignLeft className="size-3" />
                  {t('paragraphCount', { count: paragraphs.length })}
                </span>
                <span>{t('textSource')}</span>
              </div>
            ) : null}
          </div>
          {selected ? (
            <div className="meeting-actions">
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  void act(async () => {
                    await window.cherry.file.save('export.md', encodeText(meetingMarkdown(selected)))
                    await window.cherry.file.export('export.md', { suggestedName: 'meeting.md' })
                  })
                }>
                <Download className="size-4" />
                <span>{t('exportMd')}</span>
              </Button>
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  void act(async () => {
                    await window.cherry.file.export(`meeting-${selected.id}.json`, { suggestedName: 'meeting.json' })
                  })
                }
                title={t('exportJson')}
                aria-label={t('exportJson')}
                size="icon">
                <FileJson className="size-4" />
              </Button>
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => setDeleting(!deleting)}
                title={t('delete')}
                aria-label={t('delete')}
                size="icon">
                <Trash2 className="size-4" />
              </Button>
            </div>
          ) : null}
        </header>
        {error ? (
          <div role="alert" className="meeting-alert">
            <p>{t(error)}</p>
            <Button variant="outline" onClick={() => void reload()} disabled={busy || running}>
              {t('retry')}
            </Button>
          </div>
        ) : null}
        {deleting && selected ? (
          <div className="meeting-delete-confirm">
            <span>{t('deletePrompt')}</span>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={disabled}
              onClick={() =>
                void act(async () => {
                  await window.cherry.file.delete(`meeting-${selected.id}.json`)
                  setMeetings((rows) => rows.filter((row) => row.id !== selected.id))
                  reset()
                })
              }>
              {t('confirmDelete')}
            </Button>
          </div>
        ) : null}
        {!selected ? (
          <section className="meeting-setup">
            <div className="meeting-setup-intro">
              <div className="meeting-setup-icon">
                <FileText className="size-6" />
              </div>
              <h2>{t('setupTitle')}</h2>
              <p>{t('empty')}</p>
            </div>
            <div className="meeting-setup-card" role="form">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">{t('import')}</span>
                <Input
                  type="file"
                  accept=".txt,.srt,.json"
                  disabled={disabled}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file)
                      void act(async () => {
                        if (file.size > 5_000_000) throw new Error('fileTooLarge')
                        await persist(importMeeting(file.name, await file.text()))
                      })
                  }}
                />
              </label>
              <div className="meeting-separator">
                <span>{t('orPaste')}</span>
              </div>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">{t('name')}</span>
                <Input
                  value={title}
                  required
                  maxLength={200}
                  disabled={disabled}
                  placeholder={t('namePlaceholder')}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">{t('transcript')}</span>
                <Textarea.Input
                  className="meeting-transcript-input"
                  value={text}
                  required
                  disabled={disabled}
                  maxLength={500_000}
                  placeholder={t('textPlaceholder')}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <Button
                className="w-full"
                size="lg"
                type="button"
                disabled={disabled || !title.trim() || !text.trim()}
                onClick={() =>
                  void act(async () => {
                    await persist(importMeeting(`${title.trim()}.txt`, text))
                    setText('')
                    setTitle('')
                  })
                }>
                <Plus className="size-4" />
                {t('save')}
              </Button>
            </div>
          </section>
        ) : (
          <div className="meeting-content">
            <section className="meeting-transcript" aria-label={t('transcript')}>
              <h2 className="meeting-section-title">
                <AlignLeft className="size-4" />
                {t('transcript')}
              </h2>
              <div className="meeting-transcript-list">
                {paragraphs.map((paragraph, index) => (
                  <article className="meeting-transcript-row" key={`${selected.id}-${index}`}>
                    <span className="meeting-paragraph-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="meeting-paragraph-meta">
                        {paragraph.timestamp ?? t('paragraph', { number: index + 1 })}
                      </div>
                      <p>{paragraph.text}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <section className="meeting-results">
              <Tabs defaultValue="summary" className="meeting-result-tabs">
                <TabsList className="meeting-tabs-list">
                  <TabsTrigger value="summary">{t('summary')}</TabsTrigger>
                  {selected.summaryHtml ? <TabsTrigger value="notes">{t('detailedNotes')}</TabsTrigger> : null}
                  <TabsTrigger value="map">{t('mindMap')}</TabsTrigger>
                </TabsList>
                <TabsContent value="summary" className="meeting-result-panel">
                  {selected.summaryHtml ? (
                    <MeetingSummaryView html={selected.summaryHtml} title={t('summary')} />
                  ) : selected.summary ? (
                    <div className="meeting-markdown-card">
                      <Markdown id={selected.id}>{selected.summary}</Markdown>
                    </div>
                  ) : (
                    <div className="meeting-empty-result">
                      <Sparkles className="size-10" />
                      <h2>{t('summaryEmptyTitle')}</h2>
                      <p>{t('summaryEmptyHint')}</p>
                    </div>
                  )}
                </TabsContent>
                {selected.summaryHtml ? (
                  <TabsContent value="notes" className="meeting-result-panel">
                    <div className="meeting-markdown-card">
                      <Markdown id={`${selected.id}-notes`}>{selected.summary}</Markdown>
                    </div>
                  </TabsContent>
                ) : null}
                <TabsContent value="map" className="meeting-map-panel">
                  {selected.mindMap.length ? (
                    <MeetingMindMapView
                      nodes={parseMindMap(selected.mindMap)}
                      title={selected.title}
                      ariaLabel={t('mindMap')}
                    />
                  ) : (
                    <div className="meeting-empty-result">
                      <Network className="size-10" />
                      <h2>{t('noMap')}</h2>
                      <p>{t('mapEmptyHint')}</p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
              <div className="meeting-generation">
                <div className="flex flex-wrap items-center gap-2">
                  {running ? (
                    <Button variant="outline" onClick={() => controller.current?.abort()}>
                      <Square className="size-3" />
                      {t('stop')}
                    </Button>
                  ) : (
                    <Button disabled={disabled || complete} onClick={() => void generate(selected)}>
                      <Sparkles className="size-4" />
                      {t(complete ? 'organized' : selected.taskId ? 'resume' : 'generate')}
                    </Button>
                  )}
                  {selected.summary && selected.taskId && !selected.summaryHtml ? (
                    <Button variant="ghost" disabled={disabled} onClick={() => void generate(selected, true)}>
                      {t('generateVisual')}
                    </Button>
                  ) : null}
                  {running ? (
                    <span role="status" className="text-xs text-muted-foreground">
                      {t(visible ? 'working' : 'hidden')}
                    </span>
                  ) : null}
                </div>
                <p>{t('disclosure')}</p>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
