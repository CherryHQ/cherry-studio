export const modelSettingsDetailClasses = {
  headerPad: 'shrink-0 px-6 py-2.5',
  scrollViewport: 'px-6 pt-1.5 pb-6',
  contentMaxWidth: 'mx-auto w-full max-w-5xl',
  /** Header inner wrapper: same max-width as body content. */
  headerContentMaxWidth: 'mx-auto w-full max-w-5xl',
  sectionStack: 'mx-auto flex min-h-full w-full min-w-0 max-w-5xl flex-col gap-5'
} as const

export const modelSettingsListClasses = {
  headerBlock: 'flex min-w-0 w-full flex-col gap-3',
  headerInlineRow: 'flex min-w-0 w-full flex-wrap items-center justify-between gap-2',
  sectionTitleLine: 'flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1',
  sectionTitle: 'm-0 shrink-0 whitespace-nowrap font-semibold text-foreground text-sm leading-[1.3]',
  toolbarDesignIcon: 'size-4 shrink-0',
  toolbarHeaderIcon: 'size-3 shrink-0',
  searchCompactWrap:
    'flex h-8 w-[min(38vw,220px)] min-w-36 items-center gap-1 rounded-[10px] border border-border-subtle bg-background px-2.5 py-1',
  searchIconButton:
    'inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-foreground shadow-none transition-colors hover:bg-accent/40 hover:text-foreground disabled:opacity-40',
  groupToggleIconButton:
    'inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-foreground shadow-none transition-colors hover:text-foreground disabled:opacity-40',
  searchIcon: 'size-3 shrink-0 text-muted-foreground',
  searchInput:
    'min-w-0 flex-1 border-none bg-transparent text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60',
  searchClear:
    'flex h-[18px] w-[18px] items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground',
  fetchActionButton:
    'h-8 min-h-0 gap-1.5 rounded-md border-border-subtle bg-background px-2.5 py-0 text-sm leading-5 text-foreground shadow-none hover:bg-accent/40 hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5',
  emptyState:
    'flex min-h-40 items-center justify-center rounded-2xl border border-border border-dashed bg-muted/30 px-4 text-center text-sm leading-5 text-foreground-tertiary',
  listScroller: 'min-h-0 min-w-0 w-full mt-1',
  virtualModelRow: 'border-x border-border-subtle bg-transparent',
  virtualModelRowLast: 'rounded-b-lg border-b border-border-subtle pb-1',
  groupCard: 'group/modelGroup min-w-0 w-full overflow-hidden rounded-lg border border-border-subtle bg-transparent',
  groupCardOpen: 'rounded-b-none border-b-transparent',
  groupHeader:
    'group/groupRow flex min-h-9 w-full items-center justify-between gap-2 bg-muted/30 px-4 text-left outline-none focus-visible:outline-none',
  groupHeaderOpen: '[border-bottom:0.5px_solid_var(--border-subtle)]',
  groupToggleButton:
    'flex min-w-0 max-w-full items-center gap-2 bg-transparent text-left outline-none focus-visible:outline-none',
  groupTitle: 'min-w-0 truncate text-sm leading-5 text-foreground',
  groupChevron: 'size-4 shrink-0 text-muted-foreground transition-transform duration-150',
  groupChevronOpen: 'rotate-90',
  row: 'group flex min-h-[42px] items-center gap-2.5 px-4 py-1 text-foreground leading-none',
  rowLabel: 'text-sm leading-none',
  rowAvatar:
    'inline-flex size-6.5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border [&_*]:overflow-hidden [&_*]:rounded-[inherit] [&_img]:rounded-[inherit] [&_svg]:rounded-[inherit]'
} as const
