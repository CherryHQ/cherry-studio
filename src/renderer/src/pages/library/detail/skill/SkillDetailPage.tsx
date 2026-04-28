import { Badge, Button, Separator } from '@cherrystudio/ui'
import CodeViewer from '@renderer/components/CodeViewer'
import RichEditor from '@renderer/components/RichEditor'
import type { InstalledSkill, SkillFileNode } from '@types'
import type { TFunction } from 'i18next'
import { ArrowLeft, Clock, FileText, Loader2, Tag, Trash2, Zap } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSkillMutationsById } from '../../adapters/skillAdapter'
import { useEnsureTags, useEntityTags, useSyncEntityTags, useTagList } from '../../adapters/tagAdapter'
import { TagSelector } from '../../TagSelector'
import { FileTreeNode, guessLanguage, isMarkdownFile } from './skillFileTree'

interface Props {
  skill: InstalledSkill
  onBack: () => void
  /** Fired after a successful uninstall so the parent can return to the list. */
  onUninstalled?: () => void
}

function findFirstFile(nodes: SkillFileNode[], predicate: (node: SkillFileNode) => boolean): string | null {
  for (const node of nodes) {
    if (node.type === 'file' && predicate(node)) return node.path
    if (node.children) {
      const child = findFirstFile(node.children, predicate)
      if (child) return child
    }
  }
  return null
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

function timeAgo(t: TFunction, dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('library.time_ago.just_now')
  if (mins < 60) return t('library.time_ago.minutes', { count: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('library.time_ago.hours', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('library.time_ago.days', { count: days })
  return t('library.time_ago.months', { count: Math.floor(days / 30) })
}

/**
 * Resource-library skill detail view.
 *
 * Source files remain the real skill file tree; the preview below follows the
 * currently selected file. User tags are global entity_tag bindings, while
 * SKILL.md metadata tags stay on `sourceTags` and are not edited here.
 */
const SkillDetailPage: FC<Props> = ({ skill, onBack, onUninstalled }) => {
  const { t } = useTranslation()
  const { uninstallSkill } = useSkillMutationsById(skill.id)
  const { ensureTags } = useEnsureTags()
  const { syncEntityTags } = useSyncEntityTags()
  const tagList = useTagList()
  const entityTags = useEntityTags('skill', skill.id)

  const [fileTree, setFileTree] = useState<SkillFileNode[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingTree, setLoadingTree] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [localTags, setLocalTags] = useState<string[]>(() => skill.tags.map((tag) => tag.name))
  const [tagError, setTagError] = useState<string | null>(null)
  const [savingTags, setSavingTags] = useState(false)

  const isBuiltin = skill.source === 'builtin'
  const selectedFileName = selectedFile ? (selectedFile.split('/').pop() ?? selectedFile) : null
  const sourceTags = skill.sourceTags ?? []

  const displayTags = useMemo(() => {
    if (entityTags.supported && !entityTags.isLoading && !entityTags.error) return entityTags.tags
    return skill.tags
  }, [entityTags.error, entityTags.isLoading, entityTags.supported, entityTags.tags, skill.tags])

  // Skip resync while a mutation is in flight — otherwise the SWR refresh from
  // a quick first toggle can clobber the user's optimistic state for a second
  // toggle landing right after.
  useEffect(() => {
    if (savingTags) return
    setLocalTags(displayTags.map((tag) => tag.name))
  }, [displayTags, savingTags])

  // Load the skill's file tree on mount / id change. Auto-select SKILL.md when
  // present, otherwise the first markdown file, then the first file.
  useEffect(() => {
    let cancelled = false
    setLoadingTree(true)
    void window.api.skill
      .listFiles(skill.id)
      .then((result) => {
        if (cancelled) return
        if (result.success) {
          setFileTree(result.data)
          const skillMd = findFirstFile(result.data, (node) => node.name.toLowerCase() === 'skill.md')
          const firstMarkdown = findFirstFile(result.data, (node) => isMarkdownFile(node.name))
          const firstFile = findFirstFile(result.data, () => true)
          setSelectedFile(skillMd ?? firstMarkdown ?? firstFile)
          setExpandedDirs(new Set())
        } else {
          setFileTree([])
          setSelectedFile(null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFileTree([])
          setSelectedFile(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTree(false)
      })
    return () => {
      cancelled = true
    }
  }, [skill.id])

  // Load file content whenever the user picks a different file.
  useEffect(() => {
    if (!selectedFile) {
      setFileContent(null)
      return
    }
    let cancelled = false
    setLoadingContent(true)
    void window.api.skill
      .readSkillFile(skill.id, selectedFile)
      .then((result) => {
        if (cancelled) return
        setFileContent(result.success ? result.data : null)
      })
      .catch(() => {
        if (!cancelled) setFileContent(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false)
      })
    return () => {
      cancelled = true
    }
  }, [skill.id, selectedFile])

  const tagColorByName = useMemo(
    () => new Map(tagList.tags.map((tag) => [tag.name, tag.color ?? ''] as const).filter(([, color]) => color !== '')),
    [tagList.tags]
  )

  const allTagNames = useMemo(() => tagList.tags.map((tag) => tag.name), [tagList.tags])

  const tree = useMemo(
    () =>
      fileTree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          expandedDirs={expandedDirs}
          selectedFile={selectedFile}
          onToggleDir={(dirPath) => {
            setExpandedDirs((prev) => {
              const next = new Set(prev)
              if (next.has(dirPath)) next.delete(dirPath)
              else next.add(dirPath)
              return next
            })
          }}
          onSelectFile={setSelectedFile}
        />
      )),
    [fileTree, expandedDirs, selectedFile]
  )

  const persistTags = useCallback(
    async (nextNames: string[], previousNames: string[]) => {
      setSavingTags(true)
      try {
        const tags = await ensureTags(nextNames)
        await syncEntityTags(
          'skill',
          skill.id,
          tags.map((tag) => tag.id)
        )
        setTagError(null)
      } catch (error) {
        setLocalTags(previousNames)
        setTagError(error instanceof Error ? error.message : t('library.tag_sync_failed'))
      } finally {
        setSavingTags(false)
      }
    },
    [ensureTags, skill.id, syncEntityTags, t]
  )

  const handleTagChange = useCallback(
    (next: string[]) => {
      const previous = localTags
      setLocalTags(next)
      setTagError(null)
      void persistTags(next, previous)
    },
    [localTags, persistTags]
  )

  const handleUninstall = useCallback(async () => {
    setUninstalling(true)
    try {
      await uninstallSkill()
      window.toast.success(t('settings.skills.uninstallSuccess', { name: skill.name }))
      onUninstalled?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('library.tag_sync_failed')
      window.toast.error(message)
    } finally {
      setUninstalling(false)
    }
  }, [uninstallSkill, skill.name, onUninstalled, t])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="w-fit gap-1.5 rounded-xs px-2 text-muted-foreground/55 hover:text-foreground">
          <ArrowLeft size={14} />
          <span>{t('common.back')}</span>
        </Button>

        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-sm bg-amber-500/10 text-amber-500">
              <Zap size={30} strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-semibold text-2xl text-foreground">{skill.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="border-0 bg-amber-500/10 px-2 py-0.5 text-amber-600 text-xs">
                  {t('library.type.skill')}
                </Badge>
                <span className="text-muted-foreground/50 text-xs">{skill.source}</span>
                {skill.author ? <span className="text-muted-foreground/50 text-xs">{skill.author}</span> : null}
                {sourceTags.slice(0, 3).map((tag) => (
                  <span key={tag} className="text-muted-foreground/40 text-xs">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <Badge
            variant="secondary"
            className="shrink-0 gap-1.5 border-0 bg-emerald-500/10 px-2 py-0.5 text-emerald-600 text-xs">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            {t('library.skill_detail.installed')}
          </Badge>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="font-medium text-muted-foreground/70 text-sm">{t('library.skill_detail.description')}</h2>
          <p className="min-h-10 text-muted-foreground/65 text-sm leading-6">
            {skill.description || t('library.skill_detail.no_description')}
          </p>
        </section>

        <Separator className="bg-border/20" />

        <section className="flex flex-col gap-4">
          <h2 className="font-medium text-muted-foreground/70 text-sm">{t('library.skill_detail.source_files')}</h2>
          <div className="rounded-xs bg-muted/30 p-3">
            {loadingTree ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={16} className="animate-spin text-muted-foreground/40" />
              </div>
            ) : fileTree.length === 0 ? (
              <p className="py-5 text-center text-muted-foreground/40 text-xs">{t('settings.skills.noSkillFile')}</p>
            ) : (
              <div className="max-h-72 overflow-y-auto pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
                {tree}
              </div>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="font-medium text-muted-foreground/70 text-sm">{t('library.skill_detail.file_preview')}</h2>
          <div className="min-h-[360px] overflow-hidden rounded-xs bg-muted/30">
            {selectedFile && fileContent !== null ? (
              loadingContent ? (
                <div className="flex min-h-[360px] items-center justify-center">
                  <Loader2 size={18} className="animate-spin text-muted-foreground/40" />
                </div>
              ) : isMarkdownFile(selectedFile) ? (
                <div className="max-h-[520px] overflow-auto px-5 py-4">
                  <div className="mb-4 flex items-center gap-2 text-muted-foreground/45 text-xs">
                    <FileText size={13} />
                    <span>{selectedFileName}</span>
                  </div>
                  <RichEditor
                    key={selectedFile}
                    initialContent={fileContent}
                    isMarkdown={true}
                    editable={false}
                    showToolbar={false}
                    isFullWidth={true}
                  />
                </div>
              ) : (
                <div className="max-h-[520px] overflow-auto">
                  <CodeViewer key={selectedFile} value={fileContent} language={guessLanguage(selectedFile)} />
                </div>
              )
            ) : (
              <div className="flex min-h-[360px] flex-col items-center justify-center gap-2 text-muted-foreground/40">
                <FileText size={28} strokeWidth={1.2} />
                <span className="text-xs">
                  {selectedFile ? t('settings.skills.noSkillFile') : t('settings.skills.selectFile')}
                </span>
              </div>
            )}
          </div>
        </section>

        <Separator className="bg-border/20" />

        <section className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 font-medium text-muted-foreground/70 text-sm">
            <Tag size={14} />
            {t('library.skill_detail.tags')}
          </h2>
          <TagSelector
            value={localTags}
            onChange={handleTagChange}
            tagColorByName={tagColorByName}
            allTagNames={allTagNames}
            disabled={savingTags}
          />
          {tagError ? <p className="text-destructive/80 text-xs">{tagError}</p> : null}
        </section>

        <Separator className="bg-border/20" />

        <section className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="font-medium text-muted-foreground/60 text-sm">{t('library.skill_detail.created_at')}</span>
            <div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
              <Clock size={13} />
              <span>{formatDate(skill.createdAt)}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-medium text-muted-foreground/60 text-sm">{t('library.skill_detail.updated_at')}</span>
            <div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
              <Clock size={13} />
              <span>
                {formatDate(skill.updatedAt)} ({timeAgo(t, skill.updatedAt)})
              </span>
            </div>
          </div>
        </section>

        {!isBuiltin ? (
          <section className="flex items-center justify-between gap-4 rounded-xs border border-destructive/15 bg-destructive/5 px-5 py-4">
            <div className="min-w-0">
              <h2 className="font-medium text-foreground text-sm">{t('library.skill_detail.delete_title')}</h2>
              <p className="mt-1 text-muted-foreground/55 text-xs">{t('library.skill_detail.delete_description')}</p>
            </div>
            <Button
              variant="destructive"
              onClick={() => void handleUninstall()}
              disabled={uninstalling}
              className="shrink-0 gap-2 rounded-xs">
              {uninstalling ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              <span>{t('library.action.uninstall')}</span>
            </Button>
          </section>
        ) : null}
      </div>
    </div>
  )
}

export default SkillDetailPage
