import { codeLanguages } from '@shared/utils/codeLanguages'

/**
 * Media catalogs are curated from mime-db (the IANA-backed type→extension
 * database): every entry must exist there under the catalog's own type, and
 * `fileExtensions.test.ts` enforces both that grounding and cross-catalog
 * uniqueness. Curate for formats users actually hold — not every registered
 * type. To extend: verify the extension in mime-db, add it here, run the tests.
 *
 * `.ts`/`.mts` are deliberately absent despite mime-db's video/mp2t entry:
 * TypeScript owns them here, and the shared classifier already resolves both
 * as text.
 *
 * `.svg`/`.svgz` are deliberately absent despite mime-db's image/svg+xml
 * entry: codeLanguages owns them as source text, and the text-only agent
 * guard (`unsupportedImageRead` in `src/main/ai/runtime/claudeCode`) uses
 * this catalog to decide which files a text-only model may read — SVG
 * sources must stay readable. The image preview plugin re-adds them as
 * preview-only literals.
 *
 * `.dts` is deliberately absent despite mime-db's audio/vnd.dts entry: it
 * also names Linux Device Tree source files, which are UTF-8 text. An
 * extension-based catalog cannot serve both, and the audio claim wins over
 * the content-based text fallback in `getFileType` — so a valid `board.dts`
 * would be rejected by chat's attach gate and lose its preview and editing.
 * Leaving it unclassified lets those sources classify as text by content.
 *
 * `.mid` is deliberately absent for the same reason: MapInfo MIF/MID pairs
 * store the CSV-like attribute table in a plain-text `.mid` file, while the
 * unambiguous `.midi` keeps serving real MIDI audio.
 *
 * `.asf` is deliberately absent for the same reason: Acclaim motion-capture
 * skeletons (e.g. the CMU Graphics Lab archive) are plain-text `.asf` files,
 * while real Advanced Systems Format video shares the extension. Leaving it
 * unclassified lets the content sniff keep the skeletons as text.
 *
 * `.caf` is deliberately absent for the same reason: MIRA's Common Assembly
 * Format stores genomic assemblies as plain-text `.caf` files, while Core Audio
 * Format shares the extension. Leaving it unclassified keeps both readable.
 *
 * `.amr` is deliberately absent for the same reason: Abstract Meaning
 * Representation corpora are plain-text `.amr` files, while Adaptive Multi-Rate
 * speech shares the extension. Leaving it unclassified keeps both readable.
 */
export const imageExts = [
  '.apng',
  '.avif',
  '.bmp',
  '.dng',
  '.gif',
  '.heic',
  '.heif',
  '.ico',
  '.jfif',
  '.jpe',
  '.jpeg',
  '.jpg',
  '.jp2',
  '.jxl',
  '.ktx2',
  '.png',
  '.psd',
  '.tif',
  '.tiff',
  '.webp'
]
export const videoExts = [
  '.3g2',
  '.3gp',
  '.avi',
  '.f4v',
  '.flv',
  '.m2ts',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.ogv',
  '.qt',
  '.webm',
  '.wmv'
]
export const audioExts = [
  '.aac',
  '.aif',
  '.aifc',
  '.aiff',
  '.au',
  '.flac',
  '.m4a',
  '.m4b',
  '.mka',
  '.midi',
  '.mp2',
  '.mp3',
  '.mpga',
  '.oga',
  '.ogg',
  '.opus',
  '.ra',
  '.wav',
  '.weba',
  '.wma'
]
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
