export const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
export const videoExts = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv']
export const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.aac']
export const documentExts = ['.pdf', '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods']
export const thirdPartyApplicationExts = ['.draftsExport']
export const bookExts = ['.epub']
export const textExts = [
  '.txt', // 普通文本文件
  '.md', // Markdown 文件
  '.mdx', // Markdown 文件
  '.html', // HTML 文件
  '.htm', // HTML 文件的另一种扩展名
  '.xml', // XML 文件
  '.json', // JSON 文件
  '.yaml', // YAML 文件
  '.yml', // YAML 文件的另一种扩展名
  '.csv', // 逗号分隔值文件
  '.tsv', // 制表符分隔值文件
  '.ini', // 配置文件
  '.log', // 日志文件
  '.rtf', // 富文本格式文件
  '.org', // org-mode 文件
  '.wiki', // VimWiki 文件
  '.tex', // LaTeX 文件
  '.bib', // BibTeX 文件
  '.srt', // 字幕文件
  '.xhtml', // XHTML 文件
  '.nfo', // 信息文件（主要用于场景发布）
  '.conf', // 配置文件
  '.config', // 配置文件
  '.env', // 环境变量文件
  '.rst', // reStructuredText 文件
  '.php', // PHP 脚本文件，包含嵌入的 HTML
  '.js', // JavaScript 文件（部分是文本，部分可能包含代码）
  '.ts', // TypeScript 文件
  '.jsp', // JavaServer Pages 文件
  '.aspx', // ASP.NET 文件
  '.bat', // Windows 批处理文件
  '.sh', // Unix/Linux Shell 脚本文件
  '.py', // Python 脚本文件
  '.ipynb', // Jupyter 笔记本格式
  '.rb', // Ruby 脚本文件
  '.pl', // Perl 脚本文件
  '.sql', // SQL 脚本文件
  '.css', // Cascading Style Sheets 文件
  '.less', // Less CSS 预处理器文件
  '.scss', // Sass CSS 预处理器文件
  '.sass', // Sass 文件
  '.styl', // Stylus CSS 预处理器文件
  '.coffee', // CoffeeScript 文件
  '.ino', // Arduino 代码文件
  '.asm', // Assembly 语言文件
  '.go', // Go 语言文件
  '.scala', // Scala 语言文件
  '.swift', // Swift 语言文件
  '.kt', // Kotlin 语言文件
  '.rs', // Rust 语言文件
  '.lua', // Lua 语言文件
  '.groovy', // Groovy 语言文件
  '.dart', // Dart 语言文件
  '.hs', // Haskell 语言文件
  '.clj', // Clojure 语言文件
  '.cljs', // ClojureScript 语言文件
  '.elm', // Elm 语言文件
  '.erl', // Erlang 语言文件
  '.ex', // Elixir 语言文件
  '.exs', // Elixir 脚本文件
  '.pug', // Pug (formerly Jade) 模板文件
  '.haml', // Haml 模板文件
  '.slim', // Slim 模板文件
  '.tpl', // 模板文件（通用）
  '.ejs', // Embedded JavaScript 模板文件
  '.hbs', // Handlebars 模板文件
  '.mustache', // Mustache 模板文件
  '.jade', // Jade 模板文件 (已重命名为 Pug)
  '.twig', // Twig 模板文件
  '.blade', // Blade 模板文件 (Laravel)
  '.vue', // Vue.js 单文件组件
  '.jsx', // React JSX 文件
  '.tsx', // React TSX 文件
  '.graphql', // GraphQL 查询语言文件
  '.gql', // GraphQL 查询语言文件
  '.proto', // Protocol Buffers 文件
  '.thrift', // Thrift 文件
  '.toml', // TOML 配置文件
  '.edn', // Clojure 数据表示文件
  '.cake', // CakePHP 配置文件
  '.ctp', // CakePHP 视图文件
  '.cfm', // ColdFusion 标记语言文件
  '.cfc', // ColdFusion 组件文件
  '.m', // Objective-C 或 MATLAB 源文件
  '.mm', // Objective-C++ 源文件
  '.gradle', // Gradle 构建文件
  '.groovy', // Gradle 构建文件
  '.kts', // Kotlin Script 文件
  '.java', // Java 代码文件
  '.cs', // C# 代码文件
  '.cpp', // C++ 代码文件
  '.c', // C++ 代码文件
  '.h', // C++ 头文件
  '.hpp', // C++ 头文件
  '.cc', // C++ 源文件
  '.cxx', // C++ 源文件
  '.cppm', // C++20 模块接口文件
  '.ipp', // 模板实现文件
  '.ixx', // C++20 模块实现文件
  '.f90', // Fortran 90 源文件
  '.f', // Fortran 固定格式源代码文件
  '.f03', // Fortran 2003+ 源代码文件
  '.ahk', // AutoHotKey 语言文件
  '.tcl', // Tcl 脚本
  '.do', // Questa 或 Modelsim Tcl 脚本
  '.v', // Verilog 源文件
  '.sv', // SystemVerilog 源文件
  '.svh', // SystemVerilog 头文件
  '.vhd', // VHDL 源文件
  '.vhdl', // VHDL 源文件
  '.lef', // Library Exchange Format
  '.def', // Design Exchange Format
  '.edif', // Electronic Design Interchange Format
  '.sdf', // Standard Delay Format
  '.sdc', // Synopsys Design Constraints
  '.xdc', // Xilinx Design Constraints
  '.rpt', // 报告文件
  '.lisp', // Lisp 脚本
  '.il', // Cadence SKILL 脚本
  '.ils', // Cadence SKILL++ 脚本
  '.sp', // SPICE netlist 文件
  '.spi', // SPICE netlist 文件
  '.cir', // SPICE netlist 文件
  '.net', // SPICE netlist 文件
  '.scs', // Spectre netlist 文件
  '.asc', // LTspice netlist schematic 文件
  '.tf' // Technology File
]

export const ZOOM_SHORTCUTS = [
  {
    key: 'zoom_in',
    shortcut: ['CommandOrControl', '='],
    editable: false,
    enabled: true,
    system: true
  },
  {
    key: 'zoom_out',
    shortcut: ['CommandOrControl', '-'],
    editable: false,
    enabled: true,
    system: true
  },
  {
    key: 'zoom_reset',
    shortcut: ['CommandOrControl', '0'],
    editable: false,
    enabled: true,
    system: true
  }
]

export const KB = 1024
export const MB = 1024 * KB
export const GB = 1024 * MB
export const defaultLanguage = 'en-US'
