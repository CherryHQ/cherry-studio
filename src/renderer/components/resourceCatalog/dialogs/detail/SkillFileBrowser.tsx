import { FileText, Languages, Loader2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Markdown } from '@cherrystudio/ui'
import { FileTree, type FileTreeNode } from '@renderer/components/FileTree'
import { useTranslate } from '@renderer/hooks/translate'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import { getLanguageByFilePath } from '@renderer/utils/codeLanguage'
import { BUILTIN_LANGUAGE } from '@shared/data/presets/translateLanguages'
import type { SkillFileNode } from '@shared/types/skill'

const CodeViewer = lazy(() => import('@renderer/components/CodeViewer'))

const logger = loggerService.withContext('SkillFileBrowser')

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown'])
interface Props {
  skillId: string
}

function extension(filename: string): string {
  const separator = filename.lastIndexOf('.')
  return separator < 0 ? '' : filename.slice(separator + 1).toLowerCase()
}

function isMarkdownFile(filename: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extension(filename))
}

function toFileTreeNode(node: SkillFileNode): FileTreeNode {
  return {
    id: node.path,
    name: node.name,
    kind: node.type === 'directory' ? 'folder' : 'file',
    path: node.path,
    children: node.children?.map(toFileTreeNode)
  }
}

function findFirstFile(nodes: SkillFileNode[], predicate: (node: SkillFileNode) => boolean): string | null {
  for (const node of nodes) {
    if (node.type === 'file' && predicate(node)) return node.path
    const child = node.children ? findFirstFile(node.children, predicate) : null
    if (child) return child
  }
  return null
}

function findRootSkillFile(nodes: SkillFileNode[]): string | null {
  return (
    nodes.find((node) => node.type === 'file' && node.path.replaceAll('\\', '/').toLowerCase() === 'skill.md')?.path ??
    null
  )
}

function collectFilePaths(nodes: SkillFileNode[], paths = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.type === 'file') paths.add(node.path)
    if (node.children) collectFilePaths(node.children, paths)
  }
  return paths
}

function PreviewLoading() {
  const { t } = useTranslation()

  return (
    <div role="status" className="flex h-full min-h-32 items-center justify-center text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  )
}

export function SkillFileBrowser({ skillId }: Props) {
  const { t } = useTranslation()
  const [sourceTree, setSourceTree] = useState<SkillFileNode[]>([])
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [translatedContent, setTranslatedContent] = useState<string | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  const [loadingTree, setLoadingTree] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const { translate, isTranslating, cancel } = useTranslate({ loggerContext: 'SkillFileBrowser' })

  const tree = useMemo(() => sourceTree.map(toFileTreeNode), [sourceTree])
  const filePaths = useMemo(() => collectFilePaths(sourceTree), [sourceTree])
  const selectedFileName = selectedFile?.split(/[\\/]/).pop() ?? selectedFile
  const selectedIsMarkdown = selectedFile ? isMarkdownFile(selectedFile) : false
  const previewContent = showTranslation && translatedContent !== null ? translatedContent : fileContent

  useEffect(() => {
    let cancelled = false
    setLoadingTree(true)
    setSourceTree([])
    setExpandedIds(new Set())
    setSelectedFile(null)

    void window.api.skill
      .listFiles(skillId)
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          logger.warn('Failed to load skill file tree', { skillId, error: result.error })
          return
        }

        setSourceTree(result.data)
        const skillFile = findRootSkillFile(result.data)
        const markdownFile = findFirstFile(result.data, (node) => isMarkdownFile(node.name))
        setSelectedFile(skillFile ?? markdownFile ?? findFirstFile(result.data, () => true))
      })
      .catch((error) => {
        if (!cancelled) logger.warn('Failed to load skill file tree', { skillId, error })
      })
      .finally(() => {
        if (!cancelled) setLoadingTree(false)
      })

    return () => {
      cancelled = true
    }
  }, [skillId])

  useEffect(() => {
    cancel()
    setTranslatedContent(null)
    setShowTranslation(false)

    if (!selectedFile) {
      setFileContent(null)
      return
    }

    let cancelled = false
    setLoadingContent(true)
    setFileContent(null)

    void window.api.skill
      .readSkillFile(skillId, selectedFile)
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          logger.warn('Failed to load skill file content', { skillId, selectedFile, error: result.error })
          toast.error(t('library.skill_detail.file_load_failed'))
          return
        }
        if (result.data === null) {
          logger.warn('Skill file content is unavailable', { skillId, selectedFile })
          toast.error(t('library.skill_detail.file_load_failed'))
          return
        }
        setFileContent(result.data)
      })
      .catch((error) => {
        if (cancelled) return
        logger.warn('Failed to load skill file content', { skillId, selectedFile, error })
        toast.error(t('library.skill_detail.file_load_failed'))
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false)
      })

    return () => {
      cancelled = true
    }
  }, [cancel, selectedFile, skillId, t])

  const handleTranslate = async () => {
    if (!fileContent) return
    if (translatedContent !== null) {
      setShowTranslation((current) => !current)
      return
    }

    const result = await translate(fileContent, BUILTIN_LANGUAGE.zhCN.langCode)
    if (result) {
      setTranslatedContent(result)
      setShowTranslation(true)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-medium text-muted-foreground text-sm">{t('library.skill_detail.source_files')}</h3>
      <div className="grid min-h-80 overflow-hidden rounded-lg border border-border-subtle bg-background md:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="h-56 min-h-0 overflow-hidden border-border-subtle border-b bg-background-subtle md:h-96 md:border-r md:border-b-0">
          {loadingTree ? (
            <PreviewLoading />
          ) : sourceTree.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-foreground-tertiary text-xs">
              {t('library.skill_detail.no_files')}
            </div>
          ) : (
            <FileTree
              nodes={tree}
              ariaLabel={t('library.skill_detail.source_files')}
              expandedIds={expandedIds}
              onExpandedChange={setExpandedIds}
              selectedId={selectedFile}
              onSelectedChange={(id) => {
                if (id && filePaths.has(id)) setSelectedFile(id)
              }}
              stickyFolders={false}
            />
          )}
        </div>

        <div className="flex min-h-80 min-w-0 flex-col md:h-96">
          <div className="flex min-h-10 items-center justify-between gap-3 border-border-subtle border-b px-3">
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
              <FileText className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{selectedFileName ?? t('library.skill_detail.select_file')}</span>
            </div>
            {selectedIsMarkdown && fileContent ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isTranslating}
                onClick={() => void handleTranslate()}
                className="shrink-0 gap-1.5">
                {isTranslating ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Languages className="size-3.5" aria-hidden="true" />
                )}
                {isTranslating
                  ? t('library.skill_detail.translating')
                  : translatedContent === null
                    ? t('library.skill_detail.translate_to_chinese')
                    : showTranslation
                      ? t('library.skill_detail.show_original')
                      : t('library.skill_detail.show_translation')}
              </Button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {loadingContent ? (
              <PreviewLoading />
            ) : selectedFile && previewContent !== null ? (
              <Suspense fallback={<PreviewLoading />}>
                {selectedIsMarkdown ? (
                  <div className="px-4 py-3">
                    <Markdown
                      id={`${skillId}:${selectedFile}:${showTranslation ? 'translation' : 'original'}`}
                      footnoteLabel={t('common.footnotes')}>
                      {previewContent}
                    </Markdown>
                  </div>
                ) : (
                  <CodeViewer
                    key={selectedFile}
                    value={previewContent}
                    language={getLanguageByFilePath(selectedFile)}
                    height="100%"
                    expanded={false}
                    className="h-full"
                  />
                )}
              </Suspense>
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center gap-2 text-foreground-tertiary">
                <FileText className="size-7" strokeWidth={1.2} aria-hidden="true" />
                <span className="text-xs">{t('library.skill_detail.select_file')}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
