import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button
} from '@cherrystudio/ui'
import CodeViewer from '@renderer/components/CodeViewer'
import RichEditor from '@renderer/components/RichEditor'
import type { InstalledSkill, SkillFileNode } from '@types'
import { ArrowLeft, ExternalLink, FileText, Loader2, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSkillMutationsById } from '../../adapters/skillAdapter'
import { FileTreeNode, guessLanguage, isMarkdownFile } from './skillFileTree'

interface Props {
  skill: InstalledSkill
  onBack: () => void
  /** Fired after a successful uninstall so the parent can return to the list. */
  onUninstalled?: () => void
}

/**
 * Read-only detail view for a single installed skill. Mirrors
 * `pages/settings/SkillsSettings` — left column shows the skill's file tree
 * (resolved via `window.api.skill.listFiles`), right column renders the
 * selected file (Markdown via `RichEditor`, code via `CodeViewer`).
 *
 * Skill content is filesystem-backed (under the global skills storage path),
 * so reads stay on IPC; the library list adapter only owns the `/skills`
 * cache so the row metadata is consistent across pages.
 */
const SkillDetailPage: FC<Props> = ({ skill, onBack, onUninstalled }) => {
  const { t } = useTranslation()
  const { uninstallSkill } = useSkillMutationsById(skill.id)

  const [fileTree, setFileTree] = useState<SkillFileNode[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingTree, setLoadingTree] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)

  // Load the skill's file tree on mount / id change. Auto-select SKILL.md when
  // present (mirrors the settings page's first-paint behavior).
  useEffect(() => {
    let cancelled = false
    setLoadingTree(true)
    void window.api.skill
      .listFiles(skill.id)
      .then((result) => {
        if (cancelled) return
        if (result.success) {
          setFileTree(result.data)
          const skillMd = result.data.find((n) => n.type === 'file' && n.name.toLowerCase() === 'skill.md')
          setSelectedFile(skillMd?.path ?? null)
          // Top-level directories start collapsed; users can expand on demand.
          setExpandedDirs(new Set())
        } else {
          setFileTree([])
        }
      })
      .catch(() => {
        if (!cancelled) setFileTree([])
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

  const toggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      return next
    })
  }, [])

  const handleUninstall = useCallback(async () => {
    setUninstalling(true)
    try {
      await uninstallSkill()
      window.toast.success(t('settings.skills.uninstallSuccess', { name: skill.name }))
      onUninstalled?.()
    } catch (e) {
      const message = e instanceof Error ? e.message : t('library.tag_sync_failed')
      window.toast.error(message)
    } finally {
      setUninstalling(false)
    }
  }, [uninstallSkill, skill.name, onUninstalled, t])

  const selectedFileName = selectedFile ? (selectedFile.split('/').pop() ?? null) : null
  const isBuiltin = skill.source === 'builtin'

  const tree = useMemo(
    () =>
      fileTree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          expandedDirs={expandedDirs}
          selectedFile={selectedFile}
          onToggleDir={toggleDir}
          onSelectFile={setSelectedFile}
        />
      )),
    [fileTree, expandedDirs, selectedFile, toggleDir]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-border/15 border-b px-5 py-3">
        <Button variant="ghost" size="icon-sm" onClick={onBack} className="text-muted-foreground/50">
          <ArrowLeft size={14} />
        </Button>
        <Breadcrumb>
          <BreadcrumbList className="gap-1 text-xs text-muted-foreground/50 sm:gap-1">
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <button type="button" className="cursor-pointer" onClick={onBack}>
                  {t('library.config.breadcrumb')}
                </button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="[&>svg]:size-2.5" />
            <BreadcrumbItem>
              <BreadcrumbPage className="text-foreground">{skill.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-1 items-center gap-2 px-2">
          {skill.author ? (
            <Badge variant="secondary" className="border-0 bg-accent/40 px-1.5 py-px text-xs text-muted-foreground/70">
              {skill.author}
            </Badge>
          ) : null}
          <Badge variant="secondary" className="border-0 bg-accent/40 px-1.5 py-px text-xs text-muted-foreground/70">
            {isBuiltin ? t('settings.skills.builtin') : skill.source}
          </Badge>
          {skill.sourceUrl ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => window.open(skill.sourceUrl!, '_blank', 'noopener,noreferrer')}
              className="text-muted-foreground/50 hover:text-foreground"
              title={t('settings.skills.viewSource')}>
              <ExternalLink size={12} />
            </Button>
          ) : null}
        </div>
        {!isBuiltin && (
          <Button
            variant="ghost"
            onClick={() => void handleUninstall()}
            disabled={uninstalling}
            className="flex h-auto min-h-0 items-center gap-1.5 rounded-3xs px-2.5 py-1 font-normal text-destructive/80 text-xs shadow-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-0 disabled:opacity-50">
            {uninstalling ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            <span>{t('library.action.uninstall')}</span>
          </Button>
        )}
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* File tree */}
        <div className="flex w-[240px] shrink-0 flex-col border-border/15 border-r bg-background">
          <div className="px-3 pt-3 pb-2">
            <span className="text-[10px] text-muted-foreground/45 uppercase tracking-wide">
              {t('settings.skills.title')}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-1 pb-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
            {loadingTree ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={14} className="animate-spin text-muted-foreground/40" />
              </div>
            ) : fileTree.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground/40">
                {t('settings.skills.noSkillFile')}
              </p>
            ) : (
              tree
            )}
          </div>
        </div>

        {/* Viewer */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedFile && fileContent !== null ? (
            loadingContent ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 size={18} className="animate-spin text-muted-foreground/40" />
              </div>
            ) : isMarkdownFile(selectedFile) ? (
              <div className="flex-1 overflow-auto px-6 py-5">
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
              <div className="flex-1 overflow-auto">
                <CodeViewer key={selectedFile} value={fileContent} language={guessLanguage(selectedFile)} />
              </div>
            )
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
                <FileText size={28} strokeWidth={1.2} />
                <span className="text-xs">
                  {selectedFile ? t('settings.skills.noSkillFile') : t('settings.skills.selectFile')}
                </span>
                {selectedFileName ? (
                  <span className="text-[10px] text-muted-foreground/35">{selectedFileName}</span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SkillDetailPage
