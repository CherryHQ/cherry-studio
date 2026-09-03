import { Button, EmptyState, Markdown, Skeleton } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { FilePreview } from '@renderer/components/FilePreview'
import { FileTree, type FileTreeNode } from '@renderer/components/FileTree'
import { useTranslate } from '@renderer/hooks/translate'
import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { decodeFileText } from '@renderer/utils/fileTextSnapshot'
import { BUILTIN_LANGUAGE } from '@shared/data/presets/translateLanguages'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle, type TreeDir, type TreeNode } from '@shared/utils/file'
import { FileText, Languages, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('SkillFileBrowser')
const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024
const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown'])

interface Props {
  rootPath: AbsoluteFilePath
  skillId: string
}

function isMarkdownFile(filePath: string): boolean {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? ''
  return MARKDOWN_EXTENSIONS.has(extension)
}

function projectNode(node: TreeNode): FileTreeNode | null {
  if (node.basename === 'node_modules') return null
  if (node.isTreeFile()) {
    return { id: node.path, name: node.basename, kind: 'file', path: node.path }
  }
  if (!node.isTreeDir()) return null

  const children = Object.values(node.children)
    .map(projectNode)
    .filter((child): child is FileTreeNode => child !== null)
  return { id: node.path, name: node.basename, kind: 'folder', path: node.path, children }
}

function projectTree(root: TreeDir): FileTreeNode[] {
  return Object.values(root.children)
    .map(projectNode)
    .filter((node): node is FileTreeNode => node !== null)
}

function collectFiles(nodes: FileTreeNode[], files = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.kind === 'file') files.add(node.path)
    if (node.children) collectFiles(node.children, files)
  }
  return files
}

function findInitialFile(nodes: FileTreeNode[]): string | null {
  const rootSkillFile = nodes.find((node) => node.kind === 'file' && node.name.toLowerCase() === 'skill.md')
  if (rootSkillFile) return rootSkillFile.path

  for (const node of nodes) {
    if (node.kind === 'file') return node.path
    const child = node.children ? findInitialFile(node.children) : null
    if (child) return child
  }
  return null
}

export function SkillFileBrowser({ rootPath, skillId }: Props) {
  const { t } = useTranslation()
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<AbsoluteFilePath | null>(null)
  const [translatedContent, setTranslatedContent] = useState<string | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  const { translate, isTranslating, cancel } = useTranslate({ loggerContext: 'SkillFileBrowser' })
  const { root, version, isLoading, error } = useDirectoryTree(rootPath)
  // The directory mirror mutates in place; version is the projection cache key.
  const tree = useMemo(() => {
    void version
    return root ? projectTree(root) : []
  }, [root, version])
  const filePaths = useMemo(() => collectFiles(tree), [tree])

  useEffect(() => {
    if (selectedFile && filePaths.has(selectedFile)) return
    const initialFile = findInitialFile(tree)
    setSelectedFile(initialFile ? AbsoluteFilePathSchema.parse(initialFile) : null)
  }, [filePaths, selectedFile, tree])

  useEffect(() => {
    cancel()
    setTranslatedContent(null)
    setShowTranslation(false)
  }, [cancel, selectedFile])

  const handleTranslate = async () => {
    if (!selectedFile) return
    if (translatedContent !== null) {
      setShowTranslation((current) => !current)
      return
    }

    try {
      const { content } = await ipcApi.request('file.read', {
        handle: createFilePathHandle(selectedFile),
        options: { mode: 'full', encoding: 'binary' }
      })
      if (content.byteLength > TEXT_PREVIEW_MAX_BYTES) throw new Error('Skill file is too large to translate')
      const result = await translate(decodeFileText(content).content, BUILTIN_LANGUAGE.zhCN.langCode)
      if (result) {
        setTranslatedContent(result)
        setShowTranslation(true)
      }
    } catch (error) {
      logger.warn('Failed to translate Skill file', { skillId, selectedFile, error })
      toast.error(t('library.skill_detail.file_load_failed'))
    }
  }

  if (isLoading) {
    return (
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <Skeleton className="h-48 rounded-xl lg:h-full" />
        <Skeleton className="min-h-80 rounded-xl" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        preset="no-resource"
        title={t('library.skill_detail.no_files')}
        description={error.message}
        className="min-h-80"
      />
    )
  }

  const selectedFileName = selectedFile?.split('/').pop() ?? ''
  const selectedIsMarkdown = selectedFile ? isMarkdownFile(selectedFile) : false
  const previewHeader = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground text-xs">
        <FileText className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{selectedFileName || t('library.skill_detail.select_file')}</span>
      </div>
      {selectedIsMarkdown ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isTranslating}
          onClick={() => void handleTranslate()}
          className="shrink-0 gap-1.5">
          {isTranslating ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Languages className="size-3.5" aria-hidden />
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
    </>
  )

  return (
    <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="h-48 min-h-0 overflow-hidden border-border-subtle border-b bg-background-subtle lg:h-auto lg:border-r lg:border-b-0">
        {tree.length === 0 ? (
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
              if (id && filePaths.has(id)) setSelectedFile(AbsoluteFilePathSchema.parse(id))
            }}
            stickyFolders={false}
          />
        )}
      </div>

      <div className="min-h-80 min-w-0 overflow-hidden lg:min-h-0">
        {selectedFile ? (
          showTranslation && translatedContent !== null ? (
            <div className="flex h-full min-h-80 flex-col">
              <div className="flex h-11 shrink-0 items-center gap-2 border-border border-b px-3">{previewHeader}</div>
              <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                <Markdown id={`${skillId}:${selectedFile}:translation`} footnoteLabel={t('common.footnotes')}>
                  {translatedContent}
                </Markdown>
              </div>
            </div>
          ) : (
            <FilePreview filePath={selectedFile} refreshKey={version} header={previewHeader} />
          )
        ) : (
          <div className="flex h-full min-h-80 flex-col items-center justify-center gap-2 text-foreground-tertiary">
            <FileText className="size-7" strokeWidth={1.2} aria-hidden />
            <span className="text-xs">{t('library.skill_detail.select_file')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
