import { codeLanguages } from '@shared/utils/codeLanguages'

export const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
export const videoExts = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv']
export const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.aac']
export const documentExts = ['.pdf', '.doc', '.docx', '.pptx', '.xlsx', '.xls', '.odt', '.odp', '.ods']
export const archiveExts = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz'] as const
export const knowledgeSupportedFileExts = [
  '.txt',
  '.markdown',
  '.md',
  '.mdx',
  '.json',
  '.pdf',
  '.html',
  '.htm',
  '.xlsx',
  '.xls',
  '.docx',
  '.csv',
  '.doc',
  '.pptx',
  '.ppt',
  '.epub',
  '.draftsexport'
] as const
/**
 * The extensions a knowledge base routes through a `document_to_markdown` processor.
 *
 * PDF only, deliberately — and this is a knowledge-side routing decision, not a
 * property of the processors: they all declare `inputs: ['document']` and would
 * accept an Office file. The point is that a remote OCR round-trip only earns its
 * cost (API quota, latency, uploading the document) on documents with no reliable
 * text layer. Office containers carry a structured one, which `AnydocReader`
 * extracts locally with no network call.
 *
 * Note the two are alternatives, never both: a processor's output is recorded as
 * the item's `indexedRelativePath`, and `toMaterialRelativePath` (knowledge/items.ts)
 * then makes indexing read that Markdown *instead of* the original file. Narrowing
 * this list therefore changes which rendering an Office file gets — it does not
 * remove a duplicated pass.
 *
 * Caveat: anydoc has no `win32-arm64` build, where `.pptx`/`.xls`/`.xlsx` fall back
 * to a plain-text reader that cannot decode them (AnydocReader's docblock; #18190).
 */
export const knowledgeFileProcessingExts = ['.pdf'] as const

/**
 * A flat array of all file extensions known by the linguist database.
 * This is the primary source for identifying code files.
 */
const linguistExtSet = new Set<string>()
for (const lang of Object.values(codeLanguages)) {
  if (lang.extensions) {
    for (const ext of lang.extensions) {
      linguistExtSet.add(ext)
    }
  }
}
export const codeLangExts = Array.from(linguistExtSet)

/**
 * A categorized map of custom text-based file extensions that are NOT included
 * in the linguist database. This is for special cases or project-specific files.
 */
export const customTextExts = new Map([
  [
    'language',
    [
      '.R', // R
      '.ets', // OpenHarmony,
      '.uniswap', // DeFi
      '.usf', // Unreal shader format
      '.ush' // Unreal shader header
    ]
  ],
  [
    'template',
    [
      '.vm' // Velocity
    ]
  ],
  [
    'config',
    [
      '.babelrc', // Babel
      '.bashrc',
      '.browserslistrc',
      '.conf',
      '.config', // 通用配置
      '.dockerignore', // Docker ignore
      '.eslintignore',
      '.eslintrc', // ESLint
      '.fishrc', // Fish shell配置
      '.htaccess', // Apache配置
      '.npmignore',
      '.npmrc', // npm
      '.prettierignore',
      '.prettierrc', // Prettier
      '.rc',
      '.robots', // robots.txt
      '.yarnrc',
      '.zshrc'
    ]
  ],
  [
    'document',
    [
      '.authors', // 作者文件
      '.changelog', // 变更日志
      '.license', // 许可证
      '.nfo', // 信息文件
      '.readme',
      '.text' // 纯文本
    ]
  ],
  [
    'data',
    [
      '.atom', // Feed格式
      '.ldif',
      '.map',
      '.ndjson' // 换行分隔JSON
    ]
  ],
  [
    'build',
    [
      '.bazel', // Bazel
      '.build', // Meson
      '.pom'
    ]
  ],
  [
    'database',
    [
      '.dml', // DDL/DML
      '.psql' // PostgreSQL
    ]
  ],
  [
    'web',
    [
      '.openapi', // API文档
      '.swagger'
    ]
  ],
  [
    'version',
    [
      '.bzrignore', // Bazaar ignore
      '.gitattributes', // Git attributes
      '.githistory', // Git history
      '.hgignore', // Mercurial ignore
      '.svnignore' // SVN ignore
    ]
  ],
  [
    'subtitle',
    [
      '.ass', // 字幕格式
      '.sub'
    ]
  ],
  [
    'log',
    [
      '.log',
      '.rpt' // 日志和报告 (移除了.out，因为通常是二进制可执行文件)
    ]
  ],
  [
    'eda',
    [
      '.cir',
      '.def', // LEF/DEF
      '.edif', // EDIF
      '.il',
      '.ils', // SKILL
      '.lef',
      '.net',
      '.scs', // Spectre
      '.sdf', // SDF
      '.spi'
    ]
  ]
])

/**
 * A comprehensive list of all text-based file extensions, combining the
 * extensive list from the linguist database with our custom additions.
 * The Set ensures there are no duplicates.
 */
export const textExts = [...new Set([...Array.from(customTextExts.values()).flat(), ...codeLangExts])]

/**
 * A deliberately curated set of plaintext extensions a knowledge base indexes through the
 * text-reader fallback (no dedicated extractor). This is NOT the Linguist database: every
 * entry is a decision — a format whose real-world content is text and carries retrieval
 * value. Deliberately excluded:
 * - binary or ambiguous formats that happen to appear in a text list (`.pkl`, `.pt`,
 *   `.plist`, `.stl`, `.mat`, `.msg`, `.obj`, `.raw`): a bad decode yields non-empty
 *   replacement-character text that would slip past the empty-chunk guard (#19177);
 * - text with no retrieval value (source maps, minified bundles, lockfiles);
 * - dotfile-style names (`.env`, `.eslintrc`, `.bashrc`): the renderer and main classify
 *   these differently (`split('.')` vs `path.extname`), and the main guard treats a leading
 *   dot as no extension — so admitting them by name breaks a mixed batch.
 *
 * A user who needs an extension outside this set can still pick it explicitly via the
 * "All files" picker option (see {@link RuntimeFileItemDataSchema} `allowArbitrary`), which
 * is content-checked at index time rather than gated by membership here.
 */
export const knowledgePlainTextFileExts = [
  // Config / data serialization
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.properties',
  '.xml',
  '.tsv',
  // Documentation / prose
  '.rst',
  '.org',
  '.tex',
  '.adoc',
  '.asciidoc',
  '.log',
  // Shell / scripting
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  // Source code
  '.py',
  '.pyi',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.c',
  '.h',
  '.cpp',
  '.cc',
  '.cxx',
  '.hpp',
  '.hh',
  '.cs',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  // `.ts` also names MPEG transport streams; the pre-copy binary guard rejects those before they are
  // copied in, so it is safe to admit alongside real TypeScript sources.
  '.ts',
  '.tsx',
  '.php',
  '.rb',
  '.swift',
  '.m',
  '.mm',
  '.lua',
  '.pl',
  '.pm',
  '.r',
  '.dart',
  '.ex',
  '.exs',
  '.erl',
  '.hs',
  '.clj',
  '.groovy',
  '.gradle',
  '.vue',
  '.svelte',
  // Data / query
  '.sql',
  '.graphql',
  '.gql',
  '.proto',
  // Build / infra
  '.tf',
  '.hcl'
] as const

const toLowerExtSet = (exts: readonly string[]): ReadonlySet<string> => new Set(exts.map((ext) => ext.toLowerCase()))

/**
 * Every extension a knowledge base admits without an explicit per-file opt-in: the curated
 * readers in {@link knowledgeSupportedFileExts} plus the curated plaintext set
 * {@link knowledgePlainTextFileExts}. Used by both the explicit-pick guard and bulk directory
 * expansion — the set stays small and curated so anything a user adds is something we know a
 * reader reads. Arbitrary extensions enter only through the explicit "All files" opt-in, which
 * is content-checked at index time instead of gated here.
 */
export const knowledgeIndexableFileExtSet = toLowerExtSet([
  ...knowledgeSupportedFileExts,
  ...knowledgePlainTextFileExts
])
