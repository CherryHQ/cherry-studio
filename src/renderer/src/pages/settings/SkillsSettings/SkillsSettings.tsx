import { Icon } from '@iconify/react'
import CodeViewer from '@renderer/components/CodeViewer'
import ListItem from '@renderer/components/ListItem'
import RichEditor from '@renderer/components/RichEditor'
import Scrollbar from '@renderer/components/Scrollbar'
import { useInstalledSkills, useSkillInstall, useSkillSearch } from '@renderer/hooks/useSkills'
import { getFileIconName } from '@renderer/utils/fileIconName'
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
import { type FC, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Dragger } = Upload

const TITLE_STYLE = { fontWeight: 500 } as const
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
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  // Search state (online registry)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  // Local filter state
  const [localFilter, setLocalFilter] = useState('')

  // Multi-select state
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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
    if (!searchOpen) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        const modal = (target as Element).closest?.('.ant-modal-root, .ant-modal-wrap, .ant-modal')
        if (modal) return
        setSearchOpen(false)
        setSearchQuery('')
        clear()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [searchOpen, clear])

  // Focus input when search opens
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [searchOpen])

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
        for (const skill of toDelete) {
          await uninstall(skill.id)
        }
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

  const selectedFileName = useMemo(() => {
    if (!selectedFile) return null
    const parts = selectedFile.split('/')
    return parts[parts.length - 1]
  }, [selectedFile])

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    clear()
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
        <MenuList>
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
                        <ListItem
                          title={skill.name}
                          subtitle={skill.description ?? undefined}
                          active={false}
                          onClick={() => setSelectedSkill(skill)}
                          icon={<Puzzle size={16} />}
                          titleStyle={TITLE_STYLE}
                        />
                      </div>
                    </Dropdown>
                  )
                })
              )}
            </>
          )}
        </MenuList>

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
              {searchOpen ? (
                <SearchInputWrapper>
                  <Input
                    ref={searchInputRef as React.Ref<any>}
                    size="small"
                    placeholder={t('settings.skills.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    suffix={<X size={12} style={CLOSE_ICON_STYLE} onClick={handleCloseSearch} />}
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
              ) : (
                <Tooltip title={t('settings.skills.searchRegistryTitle')}>
                  <SearchIconButton onClick={() => setSearchOpen(true)}>
                    <Search size={16} />
                  </SearchIconButton>
                </Tooltip>
              )}
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

// ─── Styled Components ───────────────────────────────────────

const Container = styled.div`
  display: flex;
  flex: 1;
`

const MainContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  width: 100%;
  height: calc(100vh - var(--navbar-height) - 6px);
  overflow: hidden;
`

const MenuList = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: var(--settings-width);
  padding: 12px;
  border-right: 0.5px solid var(--color-border);
  height: calc(100vh - var(--navbar-height));
`

const ListHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 8px;
`

const FilterContainer = styled.div`
  padding: 0 0 8px;
`

const RightContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
`

const TopBar = styled.div`
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 0.5px solid var(--color-border);
  gap: 8px;
  min-height: 44px;
`

const BackButton = styled.div`
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: var(--color-text-2);
  &:hover {
    background: var(--color-background-soft);
  }
`

const TopBarTitle = styled.div`
  font-size: 14px;
  font-weight: 500;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const TopBarRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
`

const DetailMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const SearchIconButton = styled.div`
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: var(--color-text-2);
  &:hover {
    background: var(--color-background-soft);
  }
`

const SearchInputWrapper = styled.div`
  position: relative;
  width: 280px;
`

const SearchDropdown = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  width: 100%;
  max-height: 400px;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  margin-top: 4px;
  z-index: 100;
`

const SearchTabs = styled.div`
  display: flex;
  border-bottom: 0.5px solid var(--color-border);
  flex-shrink: 0;
`

const SearchTab = styled.div<{ $active: boolean }>`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 8px;
  font-size: 11px;
  cursor: pointer;
  color: ${(p) => (p.$active ? 'var(--color-primary)' : 'var(--color-text-3)')};
  border-bottom: 2px solid ${(p) => (p.$active ? 'var(--color-primary)' : 'transparent')};
  transition: all 0.15s;
  white-space: nowrap;

  &:hover {
    color: ${(p) => (p.$active ? 'var(--color-primary)' : 'var(--color-text-2)')};
  }
`

const TabCount = styled.span`
  font-size: 10px;
  background: var(--color-background-soft);
  padding: 0 4px;
  border-radius: 8px;
  min-width: 16px;
  text-align: center;
`

const SearchResultsScroll = styled.div`
  flex: 1;
  overflow-y: auto;
`

const DropdownLoading = styled.div`
  display: flex;
  justify-content: center;
  padding: 16px;
`

const DropdownEmpty = styled.div`
  padding: 16px;
  text-align: center;
  color: var(--color-text-3);
  font-size: 12px;
`

const SearchResultItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  gap: 8px;
  &:hover {
    background: var(--color-background-soft);
  }
  & + & {
    border-top: 0.5px solid var(--color-border);
  }
`

const ResultActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`

const ExternalLinkButton = styled.div`
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: var(--color-text-3);
  &:hover {
    color: var(--color-text);
    background: var(--color-background-soft);
  }
`

const ResultInfo = styled.div`
  flex: 1;
  min-width: 0;
  cursor: pointer;
`

const ResultName = styled.div`
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ResultMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
`

const MetaBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--color-text-3);
`

const ContentArea = styled.div`
  flex: 1;
  overflow: hidden;
`

const EmptyStateContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
`

const EmptyStateTitle = styled.div`
  font-size: 16px;
  font-weight: 500;
  color: var(--color-text-1);
`

const EmptyStateDesc = styled.div`
  font-size: 13px;
  color: var(--color-text-3);
  line-height: 1.5;
`

const EmptyStateActions = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 8px;
`

const EmptyStateTip = styled.div`
  font-size: 11px;
  color: var(--color-text-3);
  opacity: 0.7;
  margin-top: 4px;
`

const DropHint = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 8px;
`

const SpinContainer = styled.div`
  display: flex;
  justify-content: center;
  padding: 20px;
`

const EmptyHint = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 16px;
`

const CheckboxItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    background: var(--color-background-soft);
  }
`

const CheckboxLabel = styled.span<{ $disabled: boolean }>`
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: ${(p) => (p.$disabled ? 0.4 : 1)};
`

const EmptyText = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
`

// ─── File Tree ──────────────────────────────────────────────

const FileTreeContainer = styled.div`
  flex: 1;
  overflow-y: auto;
`

const FileTreeItem = styled.div<{ $depth: number; $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  padding-left: ${(p) => 8 + p.$depth * 16}px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  color: ${(p) => (p.$active ? 'var(--color-text)' : 'var(--color-text-2)')};
  background: ${(p) => (p.$active ? 'var(--color-background-soft)' : 'transparent')};

  &:hover {
    background: var(--color-background-soft);
  }
`

const FileTreeName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
`

// ─── Content Viewers ────────────────────────────────────────

const MarkdownContainer = styled.div`
  height: 100%;
  overflow-y: auto;
  padding: 0;

  /* Override RichEditor wrapper styles for full-width fit */
  > div {
    border: none;
    border-radius: 0;
  }

  /* Hide TipTap drag handle and plus button in readonly mode */
  .drag-handle,
  .plus-button {
    display: none !important;
  }
`

const CodeViewerContainer = styled.div`
  height: 100%;
  overflow-y: auto;

  /* Ensure text is selectable for copy */
  user-select: text;
  -webkit-user-select: text;
`

// ─── Drop Zone ──────────────────────────────────────────────

const DropZoneContainer = styled.div`
  height: 100%;
  display: flex;
  padding-bottom: 2px;

  .ant-upload-wrapper,
  .ant-upload-drag {
    height: 100%;
    display: flex;
  }

  .ant-upload-wrapper {
    flex: 1;
  }

  .ant-upload-drag {
    flex: 1;
    background: transparent;
    border-radius: 0;
    border: 2px dashed transparent;
    border-bottom-right-radius: 6px;
    transition: border-color 0.2s;

    &.ant-upload-drag-hover {
      border-color: var(--color-primary);
    }
  }

  .ant-upload-btn {
    height: 100% !important;
    display: flex !important;
    align-items: center;
    justify-content: center;
  }
`

const DropZoneContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 360px;
  text-align: center;
`

// ─── Preview Modal ──────────────────────────────────────────

const PreviewContent = styled.div`
  p {
    margin-bottom: 12px;
    color: var(--color-text-2);
  }
`

const PreviewMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
`

const MetaItem = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--color-text-2);
`

export default SkillsSettings
