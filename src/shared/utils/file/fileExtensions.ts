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
