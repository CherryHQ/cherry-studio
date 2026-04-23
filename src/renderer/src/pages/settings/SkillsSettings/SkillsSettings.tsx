import { MenuItem, MenuList } from '@cherrystudio/ui'
import { Icon } from '@iconify/react'
import CodeViewer from '@renderer/components/CodeViewer'
import RichEditor from '@renderer/components/RichEditor'
import Scrollbar from '@renderer/components/Scrollbar'
import { useInstalledSkills, useSkillInstall, useSkillSearch } from '@renderer/hooks/useSkills'
import { getFileIconName } from '@renderer/utils/fileIconName'
import { cn } from '@renderer/utils/style'
import type { InstalledSkill, SkillFileNode, SkillSearchResult, SkillSearchSource } from '@types'
import {
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  message,
  Modal,
  Popconfirm,
  Spin,
  Tag,
  Tooltip,
  Typography,
  Upload
} from 'antd'
import {
  ArrowLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FolderOpen,
  Puzzle,
  Search,
  Star,
  Trash2,
  Upload as UploadIcon,
  X
} from 'lucide-react'
import type React from 'react'
import { type FC, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const { Dragger } = Upload

const SEARCH_SOURCES: SkillSearchSource[] = ['claude-plugins.dev', 'skills.sh', 'clawhub.ai']
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown'])
const ICON_STYLE_16 = { fontSize: 16, flexShrink: 0 } as const
const SPACER_STYLE = { width: 12, flexShrink: 0 } as const
const FLEX_1_STYLE = { flex: 1 } as const
const SKILL_NAME_STYLE = {
  fontSize: 13,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} as const
const FONT_13_STYLE = { fontSize: 13 } as const
const SEARCH_PREFIX_STYLE = { opacity: 0.4 } as const
const EMPTY_ICON_STYLE = { opacity: 0.3 } as const
const CLOSE_ICON_STYLE = { cursor: 'pointer', opacity: 0.5 } as const
const INSTALL_BTN_STYLE = { fontSize: 11, height: 22 } as const
const DROP_ICON_STYLE = { opacity: 0.2 } as const
const NO_EVENTS_STYLE = { pointerEvents: 'none' } as const
const NO_PADDING_STYLE = { padding: 0 } as const
const CHEVRON_EXPANDED = { transform: 'rotate(90deg)', transition: 'transform 0.15s', flexShrink: 0 } as const
const CHEVRON_COLLAPSED = { transform: 'none', transition: 'transform 0.15s', flexShrink: 0 } as const

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  css: 'css',
  html: 'html',
  xml: 'xml',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  txt: 'text'
}

function isMarkdownFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return MARKDOWN_EXTENSIONS.has(ext)
}

function guessLanguage(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
  return LANG_MAP[ext] ?? 'text'
}

function getFileIcon(filename: string): string {
  return `material-icon-theme:${getFileIconName(filename)}`
}

function getFolderIcon(isOpen: boolean): string {
  return isOpen ? 'material-icon-theme:folder-open' : 'material-icon-theme:folder'
}

// ─── FileTreeNode (extracted from inline renderFileTree) ─────

const FileTreeNode: FC<{
  node: SkillFileNode
  depth: number
  expandedDirs: Set<string>
  selectedFile: string | null
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
}> = memo(({ node, depth, expandedDirs, selectedFile, onToggleDir, onSelectFile }) => {
  if (node.type === 'directory') {
    const isExpanded = expandedDirs.has(node.path)
    return (
      <div>
        <FileTreeItem $depth={depth} $active={false} onClick={() => onToggleDir(node.path)} title={node.name}>
          <ChevronRight size={12} style={isExpanded ? CHEVRON_EXPANDED : CHEVRON_COLLAPSED} />
          <Icon icon={getFolderIcon(isExpanded)} style={ICON_STYLE_16} />
          <FileTreeName>{node.name}</FileTreeName>
        </FileTreeItem>
        {isExpanded &&
          node.children?.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              selectedFile={selectedFile}
              onToggleDir={onToggleDir}
              onSelectFile={onSelectFile}
            />
          ))}
      </div>
    )
  }

  const isActive = selectedFile === node.path
  return (
    <FileTreeItem
      key={node.path}
      $depth={depth}
      $active={isActive}
      onClick={() => onSelectFile(node.path)}
      title={node.name}>
      <span style={SPACER_STYLE} />
      <Icon icon={getFileIcon(node.name)} style={ICON_STYLE_16} />
      <FileTreeName>{node.name}</FileTreeName>
    </FileTreeItem>
  )
})

FileTreeNode.displayName = 'FileTreeNode'

// ─── SearchResultRow (extracted for memo) ────────────────────

const SearchResultRow: FC<{
  result: SkillSearchResult
  isInstalling: (source?: string) => boolean
  onInstall: (result: SkillSearchResult) => void
  onPreview: (result: SkillSearchResult) => void
  installLabel: string
}> = memo(({ result, isInstalling, onInstall, onPreview, installLabel }) => (
  <SearchResultItem>
    <ResultInfo onClick={() => onPreview(result)}>
      <ResultName>{result.name}</ResultName>
      <ResultMeta>
        {result.stars > 0 ? (
          <MetaBadge>
            <Star size={10} /> {result.stars}
          </MetaBadge>
        ) : null}
        {result.downloads > 0 ? (
          <MetaBadge>
            <Download size={10} /> {result.downloads}
          </MetaBadge>
        ) : null}
      </ResultMeta>
    </ResultInfo>
    <ResultActions>
      {result.sourceUrl ? (
        <Tooltip title={result.sourceRegistry}>
          <ExternalLinkButton
            onClick={(e) => {
              e.stopPropagation()
              window.open(result.sourceUrl!)
            }}>
            <ExternalLink size={12} />
          </ExternalLinkButton>
        </Tooltip>
      ) : null}
      <Button
        type="primary"
        size="small"
        icon={<Download size={12} />}
        loading={isInstalling(result.installSource)}
        onClick={() => onInstall(result)}
        style={INSTALL_BTN_STYLE}>
        {installLabel}
      </Button>
    </ResultActions>
  </SearchResultItem>
))

SearchResultRow.displayName = 'SearchResultRow'

// ─── Main Component ──────────────────────────────────────────

const SkillsSettings: FC = () => {
  const { t } = useTranslation()
  const { skills, loading, uninstall, refresh } = useInstalledSkills()
  const { results, searching, search, clear } = useSkillSearch()
  const { isInstalling, install, installFromZip, installFromDirectory } = useSkillInstall()

  const [selectedSkill, setSelectedSkill] = useState<InstalledSkill | null>(null)

  // File tree state
  const [fileTree, setFileTree] = useState<SkillFileNode[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set())

  // Search state (online registry)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  // Local filter state
  const [localFilter, setLocalFilter] = useState('')

  // Multi-select state
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  // Search tab state
  const [searchTab, setSearchTab] = useState<SkillSearchSource>('claude-plugins.dev')

  // Search result detail preview
  const [previewResult, setPreviewResult] = useState<SkillSearchResult | null>(null)

  // Load file tree when a skill is selected
  useEffect(() => {
    if (!selectedSkill) {
      setFileTree([])
      setSelectedFile(null)
      setFileContent(null)
      setExpandedDirs(new Set())
      return
    }

    window.api.skill
      .listFiles(selectedSkill.id)
      .then((result) => {
        if (result.success) {
          setFileTree(result.data)
          const skillMd = result.data.find((n) => n.type === 'file' && n.name.toLowerCase() === 'skill.md')
          if (skillMd) {
            setSelectedFile(skillMd.path)
          }
        }
      })
      .catch(() => {
        setFileTree([])
      })
  }, [selectedSkill])

  // Load file content when selectedFile changes
  useEffect(() => {
    if (!selectedSkill || !selectedFile) {
      setFileContent(null)
      return
    }
    setLoadingContent(true)
    window.api.skill
      .readSkillFile(selectedSkill.id, selectedFile)
      .then((result) => {
        setFileContent(result.success ? result.data : null)
      })
      .catch(() => {
        setFileContent(null)
      })
      .finally(() => {
        setLoadingContent(false)
      })
  }, [selectedSkill, selectedFile])

  // Close search dropdown on outside click (but not when clicking inside a modal)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        const modal = (target as Element).closest?.('.ant-modal-root, .ant-modal-wrap, .ant-modal')
        if (modal) return
        setSearchQuery('')
        clear()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [clear])

  // Filtered skills list
  const filteredSkills = useMemo(() => {
    if (!localFilter.trim()) return skills
    const q = localFilter.toLowerCase()
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.author?.toLowerCase().includes(q)
    )
  }, [skills, localFilter])

  const filteredResults = useMemo(() => {
    return results.filter((r) => r.sourceRegistry === searchTab)
  }, [results, searchTab])
  const selectedSkillId = selectedSkill?.id

  // Pre-compute tab counts in one pass (js-combine-iterations)
  const tabCounts = useMemo(() => {
    const counts = new Map<SkillSearchSource, number>()
    for (const r of results) {
      counts.set(r.sourceRegistry, (counts.get(r.sourceRegistry) ?? 0) + 1)
    }
    return counts
  }, [results])

  const handleSearch = useCallback(
    (value: string) => {
      setSearchQuery(value)
      if (value.trim()) {
        void search(value)
      } else {
        clear()
      }
    },
    [search, clear]
  )

  const handleInstall = useCallback(
    async (result: SkillSearchResult) => {
      const { skill, error } = await install(result.installSource)
      if (skill) {
        message.success(t('settings.skills.installSuccess', { name: result.name }))
        await refresh()
        setPreviewResult(null)
      } else {
        message.error(t('settings.skills.installFailed', { name: result.name }) + (error ? `: ${error}` : ''))
      }
    },
    [install, refresh, t]
  )

  const handleUninstall = useCallback(
    async (skill: InstalledSkill) => {
      const success = await uninstall(skill.id)
      if (success) {
        message.success(t('settings.skills.uninstallSuccess', { name: skill.name }))
        setSelectedSkill(null)
      }
    },
    [uninstall, t]
  )

  const handleBatchUninstall = useCallback(async () => {
    const toDelete = skills.filter((s) => selectedIds.has(s.id) && s.source !== 'builtin')
    if (toDelete.length === 0) return

    window.modal.confirm({
      title: t('settings.skills.confirmBatchUninstall', { count: toDelete.length }),
      centered: true,
      onOk: async () => {
        await Promise.all(toDelete.map((skill) => uninstall(skill.id)))
        setSelectedIds(new Set())
        setMultiSelectMode(false)
        setSelectedSkill(null)
        message.success(t('settings.skills.batchUninstallSuccess', { count: toDelete.length }))
      }
    })
  }, [skills, selectedIds, uninstall, t])

  const exitMultiSelect = useCallback(() => {
    setMultiSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  const handleContextMenuUninstall = useCallback(
    (skill: InstalledSkill) => {
      if (skill.source === 'builtin') return
      window.modal.confirm({
        title: t('settings.skills.confirmUninstall'),
        centered: true,
        onOk: () => handleUninstall(skill)
      })
    },
    [handleUninstall, t]
  )

  const handleDrop = useCallback(
    async (file: File) => {
      if (isInstalling()) return false

      const filePath = window.api.file.getPathForFile(file)
      if (!filePath) return false

      const isDirectory = await window.api.file.isDirectory(filePath)

      if (isDirectory) {
        const installed = await installFromDirectory(filePath)
        if (installed) {
          message.success(t('settings.skills.installSuccess', { name: installed.name }))
          await refresh()
        }
      } else if (file.name.toLowerCase().endsWith('.zip')) {
        const installed = await installFromZip(filePath)
        if (installed) {
          message.success(t('settings.skills.installSuccess', { name: installed.name }))
          await refresh()
        }
      } else {
        message.error(t('settings.skills.invalidFormat'))
      }

      return false
    },
    [isInstalling, installFromZip, installFromDirectory, refresh, t]
  )

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

  const handleBack = useCallback(() => {
    setSelectedSkill(null)
  }, [])

  const selectedFileName = selectedFile ? selectedFile.split('/').pop()! : null

  const handleCloseSearch = useCallback(() => {
    setSearchQuery('')
    clear()
    searchInputRef.current?.blur()
  }, [clear])

  const handleZipInstall = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const selected = await window.api.file.select({
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (selected && selected.length > 0) {
        const installed = await installFromZip(selected[0].path)
        if (installed) {
          message.success(t('settings.skills.installSuccess', { name: installed.name }))
          await refresh()
        }
      }
    },
    [installFromZip, refresh, t]
  )

  const handleDirInstall = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const selected = await window.api.file.select({
        properties: ['openDirectory']
      })
      if (selected && selected.length > 0) {
        const installed = await installFromDirectory(selected[0].path)
        if (installed) {
          message.success(t('settings.skills.installSuccess', { name: installed.name }))
          await refresh()
        }
      }
    },
    [installFromDirectory, refresh, t]
  )

  return (
    <Container>
      <MainContainer>
        {/* Left Panel */}
        <MenuScroll>
          <SkillsMenuList>
            {selectedSkill ? (
              <>
                <ListHeader>
                  <BackButton onClick={handleBack}>
                    <ArrowLeft size={14} />
                  </BackButton>
                  <Typography.Text strong style={SKILL_NAME_STYLE}>
                    {selectedSkill.name}
                  </Typography.Text>
                </ListHeader>
                <FileTreeContainer>
                  {fileTree.map((node) => (
                    <FileTreeNode
                      key={node.path}
                      node={node}
                      depth={0}
                      expandedDirs={expandedDirs}
                      selectedFile={selectedFile}
                      onToggleDir={toggleDir}
                      onSelectFile={setSelectedFile}
                    />
                  ))}
                </FileTreeContainer>
              </>
            ) : (
              <>
                <ListHeader>
                  {multiSelectMode ? (
                    <>
                      <Button
                        type="text"
                        size="small"
                        danger
                        disabled={selectedIds.size === 0}
                        icon={<Trash2 size={14} />}
                        onClick={handleBatchUninstall}>
                        {selectedIds.size > 0 ? selectedIds.size : ''}
                      </Button>
                      <div style={FLEX_1_STYLE} />
                      <Button type="text" size="small" onClick={exitMultiSelect}>
                        <X size={14} />
                      </Button>
                    </>
                  ) : (
                    <Typography.Text strong style={FONT_13_STYLE}>
                      {t('settings.skills.installed')} ({skills.length})
                    </Typography.Text>
                  )}
                </ListHeader>

                <FilterContainer>
                  <Input
                    size="small"
                    placeholder={t('settings.skills.filterPlaceholder')}
                    value={localFilter}
                    onChange={(e) => setLocalFilter(e.target.value)}
                    prefix={<Search size={12} style={SEARCH_PREFIX_STYLE} />}
                    allowClear
                  />
                </FilterContainer>

                {loading ? (
                  <SpinContainer>
                    <Spin size="small" />
                  </SpinContainer>
                ) : filteredSkills.length === 0 ? (
                  <EmptyHint>
                    <Puzzle size={32} strokeWidth={1} style={EMPTY_ICON_STYLE} />
                    <EmptyText>
                      {localFilter ? t('settings.skills.noFilterResults') : t('settings.skills.noInstalled')}
                    </EmptyText>
                  </EmptyHint>
                ) : (
                  filteredSkills.map((skill) => {
                    const isBuiltin = skill.source === 'builtin'
                    if (multiSelectMode) {
                      return (
                        <CheckboxItem
                          key={skill.id}
                          onClick={() =>
                            setSelectedIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(skill.id)) {
                                next.delete(skill.id)
                              } else if (!isBuiltin) {
                                next.add(skill.id)
                              }
                              return next
                            })
                          }>
                          <Checkbox checked={selectedIds.has(skill.id)} disabled={isBuiltin} style={NO_EVENTS_STYLE} />
                          <CheckboxLabel $disabled={isBuiltin}>{skill.name}</CheckboxLabel>
                        </CheckboxItem>
                      )
                    }
                    return (
                      <Dropdown
                        key={skill.id}
                        trigger={['contextMenu']}
                        menu={{
                          items: [
                            {
                              key: 'multiSelect',
                              label: t('settings.skills.multiSelect'),
                              onClick: () => setMultiSelectMode(true)
                            },
                            ...(!isBuiltin
                              ? [
                                  { type: 'divider' as const, key: 'div' },
                                  {
                                    key: 'uninstall',
                                    label: t('settings.skills.uninstall'),
                                    danger: true,
                                    icon: <Trash2 size={14} />,
                                    onClick: () => handleContextMenuUninstall(skill)
                                  }
                                ]
                              : [])
                          ]
                        }}>
                        <div>
                          <MenuItem
                            label={skill.name}
                            description={skill.description ?? undefined}
                            descriptionLines={2}
                            active={selectedSkillId === skill.id}
                            onClick={() => setSelectedSkill(skill)}
                            icon={<Puzzle size={16} />}
                            className="rounded-xs font-medium"
                          />
                        </div>
                      </Dropdown>
                    )
                  })
                )}
              </>
            )}
          </SkillsMenuList>
        </MenuScroll>

        {/* Right Panel */}
        <RightContainer>
          <TopBar>
            <TopBarTitle>
              {selectedSkill ? (selectedFileName ?? selectedSkill.name) : t('settings.skills.title')}
            </TopBarTitle>
            <TopBarRight ref={searchContainerRef}>
              {selectedSkill ? (
                <DetailMeta>
                  {selectedSkill.author ? <Tag color="blue">{selectedSkill.author}</Tag> : null}
                  <Tag>{selectedSkill.source === 'builtin' ? t('settings.skills.builtin') : selectedSkill.source}</Tag>
                  {selectedSkill.source !== 'builtin' ? (
                    <Popconfirm
                      title={t('settings.skills.confirmUninstall')}
                      onConfirm={() => handleUninstall(selectedSkill)}
                      okText={t('common.confirm')}
                      cancelText={t('common.cancel')}>
                      <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
                    </Popconfirm>
                  ) : null}
                </DetailMeta>
              ) : null}
              <SearchInputWrapper>
                <Input
                  ref={searchInputRef as React.Ref<any>}
                  placeholder={t('settings.skills.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  suffix={searchQuery ? <X size={12} style={CLOSE_ICON_STYLE} onClick={handleCloseSearch} /> : <span />}
                  prefix={<Search size={12} />}
                />
                {searching || results.length > 0 || (searchQuery && !searching) ? (
                  <SearchDropdown>
                    <SearchTabs>
                      {SEARCH_SOURCES.map((source) => {
                        const count = tabCounts.get(source) ?? 0
                        return (
                          <SearchTab key={source} $active={searchTab === source} onClick={() => setSearchTab(source)}>
                            {source.replace('.dev', '').replace('.ai', '')}
                            {count > 0 ? <TabCount>{count}</TabCount> : null}
                          </SearchTab>
                        )
                      })}
                    </SearchTabs>
                    <SearchResultsScroll>
                      {searching ? (
                        <DropdownLoading>
                          <Spin size="small" />
                        </DropdownLoading>
                      ) : null}
                      {!searching && searchQuery && filteredResults.length === 0 ? (
                        <DropdownEmpty>{t('settings.skills.noResults')}</DropdownEmpty>
                      ) : null}
                      {filteredResults.map((result) => (
                        <SearchResultRow
                          key={`${result.sourceRegistry}:${result.slug}`}
                          result={result}
                          isInstalling={isInstalling}
                          onInstall={handleInstall}
                          onPreview={setPreviewResult}
                          installLabel={t('settings.skills.install')}
                        />
                      ))}
                    </SearchResultsScroll>
                  </SearchDropdown>
                ) : null}
              </SearchInputWrapper>
            </TopBarRight>
          </TopBar>

          <ContentArea>
            {selectedSkill ? (
              loadingContent ? (
                <SpinContainer>
                  <Spin />
                </SpinContainer>
              ) : selectedFile && fileContent !== null ? (
                isMarkdownFile(selectedFile) ? (
                  <MarkdownContainer>
                    <RichEditor
                      key={selectedFile}
                      initialContent={fileContent}
                      isMarkdown={true}
                      editable={false}
                      showToolbar={false}
                      isFullWidth={true}
                    />
                  </MarkdownContainer>
                ) : (
                  <CodeViewerContainer>
                    <CodeViewer key={selectedFile} value={fileContent} language={guessLanguage(selectedFile)} />
                  </CodeViewerContainer>
                )
              ) : (
                <EmptyStateContainer>
                  <Empty
                    description={selectedFile ? t('settings.skills.noSkillFile') : t('settings.skills.selectFile')}
                  />
                </EmptyStateContainer>
              )
            ) : (
              <DropZoneContainer>
                <Dragger
                  showUploadList={false}
                  beforeUpload={handleDrop}
                  disabled={isInstalling()}
                  multiple={false}
                  openFileDialogOnClick={false}>
                  <DropZoneContent>
                    <Puzzle size={48} strokeWidth={1} style={DROP_ICON_STYLE} />
                    <EmptyStateTitle>{t('settings.skills.emptyTitle')}</EmptyStateTitle>
                    <EmptyStateDesc>{t('settings.skills.emptyDesc')}</EmptyStateDesc>
                    <EmptyStateActions>
                      <Button icon={<UploadIcon size={14} />} loading={isInstalling('zip')} onClick={handleZipInstall}>
                        {t('settings.skills.installFromZip')}
                      </Button>
                      <Button
                        icon={<FolderOpen size={14} />}
                        loading={isInstalling('directory')}
                        onClick={handleDirInstall}>
                        {t('settings.skills.installFromDirectory')}
                      </Button>
                    </EmptyStateActions>
                    <DropHint>{t('settings.skills.dropHint')}</DropHint>
                    <EmptyStateTip>{t('settings.skills.emptyTip')}</EmptyStateTip>
                  </DropZoneContent>
                </Dragger>
              </DropZoneContainer>
            )}
          </ContentArea>
        </RightContainer>
      </MainContainer>

      <Modal
        title={previewResult?.name}
        open={!!previewResult}
        onCancel={() => setPreviewResult(null)}
        footer={
          <Button
            type="primary"
            icon={<Download size={14} />}
            loading={previewResult ? isInstalling(previewResult.installSource) : false}
            onClick={() => previewResult && handleInstall(previewResult)}>
            {t('settings.skills.install')}
          </Button>
        }
        width={560}>
        {previewResult ? (
          <PreviewContent>
            {previewResult.description ? <p>{previewResult.description}</p> : null}
            <PreviewMeta>
              {previewResult.author ? (
                <MetaItem>
                  <span>{t('settings.skills.author')}:</span> {previewResult.author}
                </MetaItem>
              ) : null}
              {previewResult.stars > 0 ? (
                <MetaItem>
                  <Star size={14} /> {previewResult.stars}
                </MetaItem>
              ) : null}
              {previewResult.downloads > 0 ? (
                <MetaItem>
                  <Download size={14} /> {previewResult.downloads}
                </MetaItem>
              ) : null}
              <MetaItem>
                <Tag color="blue">{previewResult.sourceRegistry}</Tag>
              </MetaItem>
              {previewResult.sourceUrl ? (
                <MetaItem>
                  <Button
                    type="link"
                    size="small"
                    icon={<ExternalLink size={14} />}
                    onClick={() => window.open(previewResult.sourceUrl!)}
                    style={NO_PADDING_STYLE}>
                    {t('settings.skills.viewSource')}
                  </Button>
                </MetaItem>
              ) : null}
            </PreviewMeta>
          </PreviewContent>
        ) : null}
      </Modal>
    </Container>
  )
}

// ─── Tailwind Components ────────────────────────────────────

type DivProps = React.ComponentPropsWithoutRef<'div'>
type SpanProps = React.ComponentPropsWithoutRef<'span'>

const divWithClass =
  (classes: string) =>
  ({ ref, className, ...props }: DivProps & { ref?: React.RefObject<HTMLDivElement | null> }) => (
    <div ref={ref} className={cn(classes, className)} {...props} />
  )

const spanWithClass =
  (classes: string) =>
  ({ className, ...props }: SpanProps) => <span className={cn(classes, className)} {...props} />

const Container = divWithClass('flex flex-1')
const MainContainer = divWithClass(
  'flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden'
)
const SkillsMenuList = ({ className, ...props }: React.ComponentProps<typeof MenuList>) => (
  <MenuList
    className={cn(
      'flex min-h-full w-(--settings-width) flex-col gap-[5px] p-3 pb-12 [box-sizing:border-box]',
      className
    )}
    {...props}
  />
)
const MenuScroll = ({ className, ...props }: React.ComponentProps<typeof Scrollbar>) => (
  <Scrollbar
    className={cn(
      'h-[calc(100vh-var(--navbar-height))] w-(--settings-width) border-border border-r-[0.5px]',
      className
    )}
    {...props}
  />
)
const ListHeader = divWithClass('flex items-center gap-2 pt-1 pb-2')
const FilterContainer = divWithClass('pb-2')
const RightContainer = divWithClass('relative flex flex-1 flex-col')
const TopBar = divWithClass('flex min-h-11 items-center gap-2 border-border border-b-[0.5px] px-4 py-2.5')
const BackButton = divWithClass(
  'flex cursor-pointer items-center rounded p-1 text-foreground-secondary hover:bg-accent'
)
const TopBarTitle = divWithClass('flex-1 truncate font-medium text-sm')
const TopBarRight = divWithClass('relative flex items-center gap-2')
const DetailMeta = divWithClass('flex items-center gap-1.5')
const SearchInputWrapper = divWithClass('relative w-[280px]')
const SearchDropdown = divWithClass(
  'absolute top-full right-0 z-100 mt-1 flex max-h-[400px] w-full flex-col rounded-xs border-border border-[0.5px] bg-background shadow-[0_4px_12px_rgba(0,0,0,0.1)]'
)
const SearchTabs = divWithClass('flex shrink-0 border-border border-b-[0.5px]')
const SearchTab = ({ className, $active, ...props }: DivProps & { $active: boolean }) => (
  <div
    className={cn(
      'flex flex-1 cursor-pointer items-center justify-center gap-1 whitespace-nowrap border-b-2 px-2 py-1.5 text-[11px] transition-all',
      $active
        ? 'border-primary text-primary'
        : 'border-transparent text-foreground-muted hover:text-foreground-secondary',
      className
    )}
    {...props}
  />
)
const TabCount = spanWithClass('min-w-4 rounded-xs bg-accent px-1 text-center text-[10px]')
const SearchResultsScroll = divWithClass('flex-1 overflow-y-auto')
const DropdownLoading = divWithClass('flex justify-center p-4')
const DropdownEmpty = divWithClass('p-4 text-center text-foreground-muted text-xs')
const SearchResultItem = divWithClass(
  'flex items-center justify-between gap-2 border-border border-t-[0.5px] px-3 py-2 first:border-t-0 hover:bg-accent'
)
const ResultActions = divWithClass('flex shrink-0 items-center gap-1')
const ExternalLinkButton = divWithClass(
  'flex cursor-pointer items-center rounded p-1 text-foreground-muted hover:bg-accent hover:text-foreground'
)
const ResultInfo = divWithClass('min-w-0 flex-1 cursor-pointer')
const ResultName = divWithClass('truncate font-medium text-[13px]')
const ResultMeta = divWithClass('mt-0.5 flex items-center gap-1.5')
const MetaBadge = spanWithClass('inline-flex items-center gap-0.5 text-[11px] text-foreground-muted')
const ContentArea = divWithClass('flex-1 overflow-hidden')
const EmptyStateContainer = divWithClass('flex h-full items-center justify-center')
const EmptyStateTitle = divWithClass('font-medium text-base text-foreground')
const EmptyStateDesc = divWithClass('text-[13px] text-foreground-muted leading-1.5')
const EmptyStateActions = divWithClass('mt-2 flex gap-2')
const EmptyStateTip = divWithClass('mt-1 text-[11px] text-foreground-muted opacity-70')
const DropHint = divWithClass('mt-2 text-foreground-muted text-xs')
const SpinContainer = divWithClass('flex justify-center p-5')
const EmptyHint = divWithClass('flex flex-col items-center gap-2 px-4 py-10')
const CheckboxItem = divWithClass('flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 hover:bg-accent')
const CheckboxLabel = ({ className, $disabled, ...props }: SpanProps & { $disabled: boolean }) => (
  <span className={cn('truncate text-[13px]', $disabled && 'opacity-40', className)} {...props} />
)
const EmptyText = divWithClass('text-foreground-muted text-xs')

const FileTreeContainer = divWithClass('flex-1 overflow-y-auto')
const FileTreeItem = ({
  className,
  $depth,
  $active,
  style,
  ...props
}: DivProps & { $depth: number; $active: boolean }) => (
  <div
    className={cn(
      'flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-xs hover:bg-accent',
      $active ? 'bg-accent text-foreground' : 'text-foreground-secondary',
      className
    )}
    style={{ paddingLeft: 8 + $depth * 16, ...style }}
    {...props}
  />
)
const FileTreeName = spanWithClass('flex-1 truncate')
const MarkdownContainer = divWithClass(
  'h-full overflow-y-auto p-0 [&_.drag-handle]:hidden! [&_.plus-button]:hidden! [&>div]:rounded-none [&>div]:border-none'
)
const CodeViewerContainer = divWithClass('h-full select-text overflow-y-auto')
const DropZoneContainer = divWithClass(
  'flex h-full pb-0.5 [&_.ant-upload-btn]:flex! [&_.ant-upload-btn]:h-full! [&_.ant-upload-btn]:items-center [&_.ant-upload-btn]:justify-center [&_.ant-upload-drag.ant-upload-drag-hover]:border-primary [&_.ant-upload-drag]:flex [&_.ant-upload-drag]:flex-1 [&_.ant-upload-drag]:rounded-none [&_.ant-upload-drag]:rounded-br-md [&_.ant-upload-drag]:border-2 [&_.ant-upload-drag]:border-dashed [&_.ant-upload-drag]:border-transparent [&_.ant-upload-drag]:bg-transparent [&_.ant-upload-drag]:transition-colors [&_.ant-upload-wrapper]:flex [&_.ant-upload-wrapper]:h-full [&_.ant-upload-wrapper]:flex-1'
)
const DropZoneContent = divWithClass('flex max-w-[360px] flex-col items-center gap-3 text-center')
const PreviewContent = divWithClass('[&_p]:mb-3 [&_p]:text-foreground-secondary')
const PreviewMeta = divWithClass('flex flex-wrap items-center gap-3')
const MetaItem = divWithClass('flex items-center gap-1 text-[13px] text-foreground-secondary')

export default SkillsSettings
