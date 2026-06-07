import { cn } from '@renderer/utils'

/**
 * Provider settings — composed className bags for the provider detail surface.
 *
 * The surface uses the global `@cherrystudio/ui` / Tailwind v2 theme directly (`bg-accent`,
 * `text-muted-foreground`, `border-border`, …) — there is no longer a forked palette or `--color-*`
 * bridge. The companion `assets/styles/provider-settings.css` only supplies a tighter
 * radius scale, a few scope-local tokens (`--provider-list-row-gap`, `--color-surface-*-soft`, glyph
 * size, opaque drawer surface) and the model-list `@container` queries.
 *
 * Off-scale values with no theme-token equivalent stay as arbitrary utilities (`text-[13px]`,
 * `leading-[1.25]`). `ProviderSetting.tsx` wraps the column in `.provider-settings-default-scope`;
 * secondary actions use `btnNeutral`, not a brand primary fill, unless the spec demands emphasis.
 */
export const providerSettingsTypography = {
  menu: 'text-sm',
  body: 'text-sm',
  label: 'text-xs',
  micro: 'text-xs',
  caption: 'text-xs',
  subtitle: 'text-base'
} as const

/** Connection — `bg-muted/50` strip + `border-border` hairline.
 * Fixed `h-8` (32px) so all input groups in this page line up regardless of trailing-control height. */
const providerSettingsInputGroupBase = 'h-8 rounded-lg border border-border bg-muted/50 px-2.5 shadow-none'

/** Softer focus ring than `@cherrystudio/ui` InputGroup default (`ring-[3px]`) — business-layer override only. */
const providerSettingsInputGroupFocusOverride =
  'has-[[data-slot=input-group-control]:focus-visible]:ring-[1px] has-[[data-slot=input-group-control]:focus-visible]:ring-ring/35'

/** Connection and `ProviderSection`: 14px, deepest foreground, section-label line-height. */
const sectionHeadingBase = 'm-0 text-base text-foreground leading-[1.3]'

export const sectionHeadingClasses = cn(sectionHeadingBase, 'font-medium')

/**
 * Authentication card: bordered container + section title.
 */
export const authConnectionClasses = {
  shell: 'rounded-xl border border-border px-3.5 py-3',
  body: 'flex flex-col gap-2'
} as const

/**
 * Provider detail column (`ProviderSetting.tsx`) — padding + gap between Authentication + ModelList.
 */
export const providerDetailColumnClasses = {
  headerPad: 'shrink-0 px-6 pt-3',
  scrollStrip: 'min-h-0 flex-1 overflow-x-hidden px-6 pt-8 pb-4',
  contentMaxWidth: 'mx-auto w-full max-w-3xl',
  /** Header inner wrapper: same max-width as body content + bottom divider aligned to content edges. */
  headerContentMaxWidth: 'mx-auto w-full max-w-3xl border-b border-border pb-2',
  sectionStack: 'mx-auto flex min-h-full w-full min-w-0 max-w-3xl flex-col gap-8'
} as const

/** Connection-field actions (neutral outline buttons + caption-size labels). */
export const actionClasses = {
  row: 'flex flex-wrap items-center gap-3',
  icon: 'size-[13px] shrink-0',
  btnBase: 'h-auto min-h-0 gap-2 rounded-lg px-3 py-1.5 text-[13px] leading-[1.25] shadow-none',
  /** Neutral outline (design: action row — no brand fill on check / API-key-list actions). */
  btnNeutral: 'border-border/25 bg-transparent text-foreground/70 hover:bg-accent hover:text-foreground'
} as const

/** Provider list rows + detached menus. */
export const providerListClasses = {
  shell: 'flex h-full w-[200px] shrink-0 basis-[200px] flex-col border-r border-border',
  headerIconButton:
    'flex size-6 shrink-0 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-accent/40 hover:text-foreground/75 disabled:pointer-events-none disabled:opacity-30',
  searchInlineAddButton:
    'flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground transition-colors hover:bg-accent/40 disabled:pointer-events-none disabled:opacity-30',
  searchRow: 'flex items-center gap-1.5 px-3 pb-2.5',
  searchWrap: 'flex h-8 items-center gap-1 rounded-xl border border-border bg-background py-1 pl-2.5 pr-1',
  searchIcon: 'size-4 shrink-0 text-muted-foreground/60',
  searchInput:
    'min-w-0 flex-1 bg-transparent text-sm leading-none text-foreground/80 outline-none placeholder:text-muted-foreground/60',
  scroller: 'min-h-0 flex-1 px-2.5 pb-2',
  sectionStack: 'space-y-3',
  section: 'space-y-2',
  sectionHeader: 'pb-0.5 pl-2 pr-2 pt-1.5',
  sectionHeaderAfterEnabled: 'pt-2',
  sectionLabel: 'mb-0.5 text-xs leading-[1.2] text-foreground-muted',
  emptyState: 'flex h-full min-h-40 items-center justify-center px-3 text-center text-foreground-muted text-[14px]',
  addWrap: 'shrink-0 border-t border-border px-2.5 py-2',
  addButton:
    'flex w-full items-center justify-center gap-1.5 rounded-lg border border-border border-dashed bg-transparent py-[5px] text-xs text-foreground-muted shadow-none transition-colors hover:border-border hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
  item: 'relative flex h-8 w-full items-center justify-between rounded-lg border border-transparent px-2.5 text-left shadow-none outline-none transition-colors focus-visible:ring-0',
  itemSelected: 'bg-muted',
  itemIdle: 'hover:bg-muted',
  itemAvatar: 'shrink-0 rounded-lg border border-border/30',
  itemLabel: 'truncate text-sm leading-[1.35]',
  itemMenuContent: 'w-fit min-w-32 rounded-xl p-1.5',
  itemMenuEntry: 'h-8 rounded-lg px-2.5 text-sm',
  groupHeader:
    'relative flex w-full items-center justify-between rounded-xl border border-transparent pl-2 pr-1.5 py-2 text-left shadow-none outline-none transition-colors hover:bg-accent/50 focus-visible:ring-0',
  groupHeaderHasSelected: 'bg-muted/30 dark:bg-muted/25',
  groupChevron: 'shrink-0 text-muted-foreground/60 transition-transform duration-150',
  groupChevronOpen: 'rotate-90',
  groupCount: 'shrink-0 text-xs leading-none text-muted-foreground/60 tabular-nums',
  groupBody: 'mt-1 flex flex-col gap-[var(--provider-list-row-gap)] pl-3.5',
  itemMoreActions:
    'absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-[color,opacity,background-color] hover:bg-foreground/4 hover:text-foreground group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 data-[active=true]:opacity-100',
  /** Enabled-state dot — shown when `provider.isEnabled` is true; hidden on row hover or focus so the kebab takes the slot. */
  itemEnabledDot:
    'pointer-events-none absolute right-2 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-green-500 transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0',
  groupAddRow:
    'flex w-full items-center gap-2 rounded-xl border border-dashed border-border bg-transparent px-2 py-[6px] text-xs leading-[1.35] text-muted-foreground/70 shadow-none transition-colors hover:border-border hover:bg-accent/40 hover:text-foreground',
  disclosureToggle:
    'flex w-full items-center gap-1.5 rounded-md bg-transparent px-1 py-1 text-left text-xs leading-none text-muted-foreground/80 shadow-none outline-none transition-colors hover:text-foreground focus-visible:ring-0',
  disclosureChevron: 'size-3 shrink-0 text-muted-foreground/60 transition-transform duration-150',
  disclosureChevronOpen: 'rotate-90',
  disclosureBody: 'mt-2 flex flex-col gap-3 pl-1'
} as const

/**
 * — custom request headers side panel: one compact key/value row per header.
 */
export const customHeaderDrawerClasses = {
  bodyScroll: 'flex flex-col gap-4 py-3',
  /** JSON mode — matches structured monospace block for custom headers. */
  headersJsonEditor:
    'min-h-[120px] w-full resize-y rounded-xl border border-border bg-muted/50 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground shadow-none outline-none focus-visible:ring-[1px] focus-visible:ring-ring/35 placeholder:text-muted-foreground/45',
  /** Header rows stack; each row is `[name] [value] [delete]` on a single line. */
  headerList: 'flex flex-col gap-2',
  headerRow: 'grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2',
  /** Quiet trailing delete: neutral until hover, then destructive. */
  removeIconButton:
    'size-7 shrink-0 rounded-lg text-muted-foreground/45 shadow-none transition-colors hover:bg-accent hover:text-destructive [&_svg]:size-3.5',
  addRowButton:
    'flex h-auto w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-muted py-2 text-xs text-muted-foreground shadow-none transition-colors hover:border-border-hover hover:bg-accent/40 hover:text-foreground'
} as const

export const drawerClasses = {
  form: 'provider-settings-default-scope flex min-h-0 flex-col gap-4 py-0',
  section: 'space-y-3',
  sectionCard: 'space-y-3.5 rounded-lg border border-border bg-background px-3 py-3 text-foreground shadow-none',
  sectionDescription: 'text-xs text-foreground-muted',
  fieldList: 'space-y-3.5',
  field: 'space-y-1.5',
  fieldTitle: 'font-medium text-sm text-foreground-secondary',
  input:
    'h-8 min-h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-none outline-none transition-[border-color,box-shadow] placeholder:text-foreground-muted disabled:cursor-not-allowed disabled:opacity-60 focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/35',
  inputDisabled: 'bg-muted text-foreground-muted',
  selectTrigger:
    'h-auto w-full rounded-md border-input bg-background px-3 py-2 text-sm text-foreground shadow-none data-[placeholder]:text-foreground-muted aria-expanded:border-ring aria-expanded:ring-[2px] aria-expanded:ring-ring/35',
  selectContent:
    'provider-settings-default-scope rounded-lg border-[0.5px] border-border bg-popover text-popover-foreground shadow-lg',
  helpText: 'text-xs text-foreground-muted',
  errorText: 'text-xs text-destructive',
  emptyInline:
    'rounded-md border border-dashed border-foreground/12 px-3 py-2 text-[13px] leading-[1.25] text-muted-foreground/70',
  toggleButton: cn(
    actionClasses.btnBase,
    actionClasses.btnNeutral,
    'justify-center gap-1.5 rounded-lg border-foreground/12 px-3 py-2 text-foreground/75 hover:bg-foreground/4 hover:text-foreground'
  ),
  inlineRow: 'flex flex-wrap items-center gap-2',
  valueRow: 'flex min-w-0 items-center gap-2',
  responsiveValueRow: 'flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center',
  valueSuffix: 'shrink-0 text-xs text-foreground-muted',
  divider: 'h-px bg-border-muted',
  switchCard: 'rounded-md border border-border bg-background px-3 py-3 [&_[data-slot=switch]]:mt-0.5',
  endpointChipRow: 'flex min-w-0 flex-wrap items-center gap-2',
  footer: 'flex items-center justify-end gap-2',
  /** Model health-check drawer: determinate progress (scoped neutral track + primary fill). */
  healthProgressTrack: 'h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/12',
  healthProgressFill: 'h-full rounded-full bg-primary transition-[width] duration-300 ease-out',
  healthProgressMeta: 'text-[13px] tabular-nums text-muted-foreground/85',
  healthProgressCurrent: 'truncate text-[13px] text-foreground/80'
} as const

/** Model list block; composes atomic tokens from `provider-settings.css` under `.provider-settings-default-scope`. */
export const modelListClasses = {
  /** Inline-size container for `@container model-list` rules in `provider-settings.css` (replaces JS width measurement). */
  cqRoot: 'ps-model-list-cq flex h-full min-h-0 min-w-0 w-full flex-1 flex-col gap-2.5',
  section: 'flex h-full min-h-0 min-w-0 w-full flex-1 flex-col gap-2.5',
  headerBlock: 'flex min-h-0 min-w-0 w-full flex-1 flex-col gap-6',
  titleRow: 'flex min-w-0 w-full flex-wrap items-center justify-between gap-3',
  /** Model list header stack — matches model list block. */
  headerToolStack: 'flex min-w-0 w-full flex-col gap-6',
  titleWrap: 'flex min-w-0 items-baseline gap-3',
  titleActions: 'flex max-w-full flex-1 flex-wrap items-center justify-end gap-2',
  toolbarDesignIcon: 'size-4 shrink-0',
  /** Connected top-row model list actions; uses shared ButtonGroup + Button outline primitives. */
  toolbarButtonGroup: 'max-w-full shrink-0',
  /** Model-list section title: same size, line-height, and color; scoped weight `--font-weight-semibold` (600). */
  sectionTitle: cn(sectionHeadingBase, 'font-semibold'),
  countMeta: 'text-xs text-foreground-muted tabular-nums',
  toolbarGhost:
    'h-auto rounded-3xs px-2.5 py-[5px] text-[13px] leading-[1.25] text-muted-foreground/70 shadow-none hover:bg-accent/40 hover:text-foreground',
  /** Model-list title-row ghost: one step tighter than `toolbarGhost` (padding + body-xs + small icon). */
  toolbarHeaderGhost:
    'h-auto min-h-0 rounded-4xs px-2 py-[3px] text-xs text-muted-foreground/70 shadow-none hover:bg-foreground/4 hover:text-foreground',
  toolbarHeaderIconButton:
    'size-8 rounded-4xs p-0 text-muted-foreground/70 shadow-none hover:bg-foreground/4 hover:text-foreground',
  toolbarIcon: 'size-[13px] shrink-0',
  toolbarHeaderIcon: 'size-3 shrink-0',
  searchExpandRow: 'flex min-w-0 w-full flex-wrap items-center gap-2',
  searchRow: 'flex min-w-0 w-full flex-wrap items-center gap-2',
  searchActions: 'flex max-w-full shrink-0 flex-wrap items-center gap-2',
  searchWrap:
    'flex h-[26px] w-full min-w-[160px] max-w-[200px] items-center gap-1 rounded-lg border border-foreground/12 bg-background px-2.5 py-1',
  searchIcon: 'size-3 shrink-0 text-muted-foreground/65',
  searchInput:
    'min-w-0 flex-1 border-none bg-transparent text-xs leading-4 text-foreground/80 outline-none placeholder:text-muted-foreground/75 disabled:cursor-not-allowed disabled:opacity-60',
  searchClear:
    'flex h-[18px] w-[18px] items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-foreground/4 hover:text-foreground/65',
  fetchActionButton:
    'h-[26px] min-h-0 gap-1.5 rounded-md border-foreground/12 bg-background px-2.5 py-0 text-xs leading-4 text-foreground shadow-none hover:bg-foreground/4 hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5',
  addModelIconButton:
    'size-[26px] min-h-0 rounded-md border-foreground/12 bg-background p-0 text-foreground shadow-none hover:bg-foreground/4 hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5',
  addIconButton:
    'size-8 rounded-lg border-foreground/12 bg-transparent text-muted-foreground/70 shadow-none hover:bg-foreground/4 hover:text-foreground',
  capabilityTabsRoot: 'relative block min-w-0 w-full overflow-hidden',
  capabilityTabsList:
    'flex h-[30px] min-w-0 max-w-full items-center justify-start gap-3 overflow-x-auto overflow-y-hidden p-0 pr-8 scroll-ps-[100px] scroll-pe-[100px] scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
  capabilityTabActive:
    'ps-model-list-cap-chip relative h-[30px] min-h-0 min-w-0 max-w-full shrink-0 gap-1.5 rounded-none px-1.5 py-1.5 text-foreground shadow-none hover:bg-transparent hover:text-foreground after:absolute after:bottom-0 after:left-1.5 after:right-1.5 after:h-[2px] after:bg-foreground after:content-[""]',
  capabilityTabIdle:
    'ps-model-list-cap-chip relative h-[30px] min-h-0 min-w-0 max-w-full shrink-0 gap-1.5 rounded-none px-1.5 py-1.5 text-foreground-muted shadow-none hover:bg-transparent hover:text-foreground/80 after:absolute after:bottom-0 after:left-1.5 after:right-1.5 after:h-[2px] after:bg-transparent after:content-[""]',
  capabilityTabIcon: 'size-3 shrink-0',
  capabilityTabLabel: 'min-w-0 truncate text-xs leading-4',
  capabilityTabsFadeMask:
    'pointer-events-none absolute inset-y-0 right-0 w-[100px] bg-[linear-gradient(to_right,transparent_0%,var(--color-background)_85%)]',
  subsectionRow: 'flex min-w-0 items-center justify-between gap-2',
  subsectionTitleWrap: 'flex min-w-0 items-center gap-2',
  subsectionActions: 'flex shrink-0 items-center gap-2 pr-1',
  subsectionIconButton:
    'inline-flex size-5 min-h-0 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground/80 shadow-none hover:bg-foreground/4 hover:text-foreground disabled:opacity-40',
  subsectionIcon: 'size-4 shrink-0',
  subsectionTooltipTrigger: 'inline-flex size-5 min-h-0 shrink-0 items-center justify-center leading-none',
  subsectionTitleEnabled: 'text-xs text-foreground-muted',
  subsectionCountEnabled: 'text-xs text-foreground-muted tabular-nums',
  subsectionTitleDisabled: 'text-xs text-foreground-muted',
  subsectionCountDisabled: 'text-xs text-foreground-muted tabular-nums',
  emptyState:
    'flex min-h-40 items-center justify-center rounded-2xl border border-(--color-border) border-dashed bg-foreground/3 px-4 text-center text-base text-foreground-muted',
  listScroller: 'min-h-0 min-w-0 w-full flex-1 overflow-x-hidden pr-1',
  /**
   * — grouped catalog inside manage drawer (flat headers, no collapse).
   */
  manageListGroupShell: 'mb-1',
  manageListGroupHeader: 'flex items-center gap-1.5 px-1 py-[3px]',
  manageListGroupTitle: 'font-medium text-xs text-foreground-muted',
  manageListGroupRule: 'h-px min-w-0 flex-1 bg-muted/50',
  manageListRow: 'group flex items-center gap-2 rounded-lg px-1.5 py-[5px] transition-colors hover:bg-accent/50',
  manageListRowLast: 'mb-0.5',
  manageDrawerFilterChipBase: 'h-auto min-h-0 rounded-full px-2 py-[2px] font-medium text-xs transition-colors',
  manageDrawerFilterChipActive: 'bg-accent/50 !text-foreground',
  manageDrawerFilterChipIdle: 'text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground',
  manageDrawerCapChipBase:
    'h-auto min-h-0 min-w-0 items-center gap-[3px] rounded-full px-1.5 py-[2px] font-medium text-xs transition-colors',
  manageDrawerCapChipActive: 'bg-accent/50 !text-foreground',
  manageDrawerCapChipIdle: 'text-foreground-muted hover:bg-accent/50 hover:text-foreground',
  manageDrawerCountBadge:
    'shrink-0 rounded-full bg-muted/50 px-1.5 py-[1px] text-xs text-muted-foreground/60 tabular-nums',
  /** Trailing close in manage drawer title row (paired with bulk actions); matches `hover:bg-accent`. */
  manageDrawerCloseInTitle:
    "ml-1 !size-6 !min-h-6 shrink-0 gap-0 rounded-lg p-0 text-muted-foreground/60 shadow-none hover:bg-accent hover:text-foreground [&_svg:not([class*='size-'])]:size-[11px]",
  manageDrawerBulkGhost:
    'inline-flex !h-auto !min-h-0 items-center justify-center gap-1 rounded-lg px-1.5 py-[2px] text-xs font-medium tracking-[-0.14px] text-muted-foreground/60 shadow-none transition-colors hover:bg-accent has-[>svg]:px-1.5',
  /** Enable-all hover — brand `--primary` in this shell (design `hover:text-cherry-primary`). */
  manageDrawerBulkGhostEnableHover: 'hover:!text-primary',
  /** Disable-all hover — destructive (design draft). */
  manageDrawerBulkGhostDisableHover: 'hover:!text-destructive',
  /**
   * Provider-grouped card (design: bordered shell with collapsible header — provider name + chevron at end).
   * Replaces the antd-coupled wrapper; rows render inside the same card on expand.
   */
  groupCard: 'min-w-0 w-full rounded-lg border border-foreground/12 bg-transparent px-3 py-2',
  groupHeader:
    'group/groupRow flex w-full items-center justify-between gap-2 bg-transparent text-left outline-none focus-visible:outline-none',
  groupToggleButton:
    'flex min-w-0 flex-1 items-center bg-transparent text-left outline-none focus-visible:outline-none',
  groupHeaderActions: 'flex shrink-0 items-center gap-1',
  groupTitle:
    'min-w-0 flex-1 truncate text-xs text-foreground-muted font-normal transition-colors group-hover/groupRow:text-foreground',
  groupChevronButton:
    'inline-flex size-5 min-h-0 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground/65 shadow-none transition-colors hover:bg-foreground/4 hover:text-foreground focus-visible:outline-none disabled:opacity-40',
  groupChevron:
    'size-4 shrink-0 text-muted-foreground/65 transition-[transform,color] duration-150 group-hover/groupRow:text-foreground',
  groupChevronOpen: 'rotate-90',
  groupBody: 'mt-1.5 flex flex-col gap-0.5',
  groupOverflowHint:
    'mt-1 rounded-lg px-3 py-2 text-left text-[13px] leading-[1.25] text-muted-foreground/70 transition-colors hover:bg-foreground/4 hover:text-foreground',
  row: 'group flex items-center gap-3 rounded-xl px-3 py-[10px] text-foreground leading-none transition-colors hover:bg-foreground/4',
  rowMain: 'min-w-0 flex-1 items-center gap-3',
  rowAvatar: 'h-[26px] w-[26px] shrink-0 rounded-lg',
  rowBody: 'min-w-0 max-w-full flex-1 overflow-hidden',
  /** Model name opens the edit drawer; copy stays on explicit trailing controls. */
  rowNameCopyable: 'cursor-pointer transition-colors hover:text-primary',
  /** Shown when model id !== name; hidden in narrow container via `.ps-model-list-id` rule. */
  modelIdBadge:
    'ps-model-list-id min-w-0 max-w-[50%] shrink truncate rounded-md bg-foreground/[0.05] px-1.5 py-[1px] font-mono text-xs text-foreground-muted',
  rowBadges: 'mt-1 flex min-h-[18px] min-w-0 max-w-full flex-wrap items-center gap-1.5',
  /** Capability / trial tags to the left of the enable switch; design: single line with the toggle. */
  rowCapabilityStrip:
    'flex min-w-0 max-w-[min(100%,20rem)] shrink items-center gap-1.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
  /** Wraps `ModelTagsWithLabel` only; pairs with `.ps-model-list-cap-strip` rules in `provider-settings.css`. */
  rowCapabilityTagCluster: 'ps-compact-cap-strip flex min-w-0 shrink items-center',
  rowMeta: 'ps-model-list-meta mt-[3px] block min-w-0 max-w-full truncate text-xs text-foreground/65',
  /** Wraps `HealthStatusIndicator` so latency (antd Typography) can be hidden via container query. */
  healthStatusSlot: 'ps-model-list-health shrink-0',
  /** Trailing column: health + (capability strip + enable) on one row. */
  rowActionsCluster: 'flex min-w-0 items-center gap-2',
  rowActions: 'min-w-0 shrink-0 items-center gap-1.5 self-center',
  rowIconButton:
    'size-7 rounded-lg border border-foreground/12 bg-transparent text-muted-foreground/70 shadow-none hover:bg-foreground/4 hover:text-foreground'
} as const

export const modelSyncClasses = {
  panel: 'provider-settings-default-scope flex min-h-0 flex-1 flex-col gap-4',
  summaryCard: 'rounded-2xl border border-foreground/12 bg-foreground/3 px-4 py-3',
  summaryTitle: 'text-base text-foreground/85 font-medium',
  summaryMeta: 'text-[13px] leading-[1.25] text-muted-foreground/75',
  summaryGrid: 'mt-3 grid gap-2 sm:grid-cols-3',
  summaryMetric:
    'rounded-xl border border-foreground/6 bg-background/75 px-3 py-2 text-[13px] leading-[1.25] text-foreground/75',
  warningBlock:
    'rounded-2xl border border-destructive/22 bg-[var(--color-surface-warning-soft)] px-4 py-3 text-[13px] leading-6 text-foreground/80',
  section: 'rounded-2xl border border-foreground/12 bg-background px-4 py-4 shadow-none',
  sectionHeader: 'flex flex-wrap items-center justify-between gap-3',
  sectionTitleWrap: 'min-w-0',
  sectionTitle: 'text-base text-foreground/85 font-medium',
  sectionMeta: 'text-[13px] leading-[1.25] text-muted-foreground/75',
  sectionActions: 'flex flex-wrap items-center gap-2',
  toggleButton: cn(
    actionClasses.btnBase,
    actionClasses.btnNeutral,
    'rounded-lg border-foreground/12 px-3 py-[5px] text-foreground/70 hover:bg-foreground/4 hover:text-foreground'
  ),
  list: 'mt-4 space-y-2',
  row: 'flex items-start gap-3 rounded-xl border border-foreground/6 bg-foreground/3 px-3 py-3',
  rowBody: 'min-w-0 flex-1',
  rowTitle: 'truncate text-base text-foreground/85',
  rowMeta: 'mt-1 text-[13px] leading-[1.25] text-muted-foreground/75',
  rowBadgeRow: 'mt-2 flex flex-wrap items-center gap-1.5',
  rowBadge: 'rounded-full border border-foreground/12 bg-background px-2 py-0.5 text-xs text-foreground/65',
  rowDangerBadge:
    'rounded-full border border-destructive/22 bg-[var(--color-surface-warning-soft)] px-2 py-0.5 text-xs text-foreground/75',
  impactCard: 'rounded-2xl border border-foreground/12 bg-[var(--color-surface-info-soft)] px-4 py-4',
  impactList: 'mt-3 space-y-2',
  impactItem:
    'rounded-xl border border-foreground/6 bg-background/80 px-3 py-2 text-[13px] leading-6 text-foreground/78',
  emptyState:
    'rounded-2xl border border-dashed border-foreground/12 bg-foreground/3 px-4 py-8 text-center text-base text-muted-foreground/75',
  footer: 'flex items-center justify-end gap-2',
  /** pull preview panel — pull result side panel */
  fetchEmpty: 'flex flex-col items-center justify-center px-4 py-12 text-center',
  fetchEmptyIconWrap: 'mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted',
  fetchEmptyIcon: 'size-4 text-foreground-muted',
  fetchEmptyTitle: 'font-medium text-xs text-foreground-secondary',
  fetchEmptyDescription: 'mt-1 text-xs text-foreground-muted',
  fetchSection: 'min-w-0',
  fetchSectionHeader: 'mb-2.5 flex items-center justify-between gap-3',
  fetchSectionTitleRow: 'flex items-center gap-1.5',
  fetchDotNew: 'h-[6px] w-[6px] shrink-0 rounded-full bg-primary',
  fetchDotRemoved: 'h-[6px] w-[6px] shrink-0 rounded-full bg-destructive',
  fetchSectionTitle: 'text-sm font-medium text-foreground',
  fetchSectionCount: 'text-xs text-foreground-muted tabular-nums',
  fetchGhostAll:
    'inline-flex !h-auto !min-h-0 items-center justify-center rounded-lg px-2 py-[3px] !text-xs !leading-none text-foreground-muted shadow-none hover:bg-accent hover:text-foreground',
  fetchGhostAllRemoved:
    'inline-flex !h-auto !min-h-0 items-center justify-center rounded-lg px-2 py-[3px] !text-xs !leading-none text-foreground-muted shadow-none hover:bg-destructive/10 hover:text-destructive',
  fetchList: 'space-y-1',
  fetchWarning:
    'my-2 gap-2 rounded-lg border-[color:color-mix(in_srgb,var(--color-warning-base)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--color-warning-bg)_52%,transparent)] px-2.5 py-2 text-xs shadow-none [&_[data-slot=alert-icon]]:mt-0 [&_[data-slot=alert-icon]_svg]:size-3.5 [&_[data-slot=alert-message]]:font-normal',
  fetchRowNew:
    'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-border/60 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/30 data-[checked=true]:border-border/40 data-[checked=true]:bg-background',
  fetchRowRemoved:
    'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-destructive/15 hover:bg-destructive/[0.03] focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/30 data-[checked=true]:border-destructive/15 data-[checked=true]:bg-background',
  fetchAvatar:
    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted font-medium text-xs leading-none text-foreground-muted',
  fetchRowTitle: 'truncate text-sm font-medium leading-5 text-foreground',
  fetchRowTitleStrike:
    'truncate text-sm font-medium leading-5 text-foreground-muted line-through decoration-foreground-muted',
  fetchRowId: 'mt-0.5 truncate font-mono text-xs text-foreground-muted',
  fetchRowIdStrike: 'mt-0.5 truncate font-mono text-xs text-foreground-muted/70',
  fetchContextValue: 'shrink-0 text-xs text-foreground-muted tabular-nums',
  /** Trailing capability icons — pull preview panel strip */
  fetchCapabilityStrip: 'ps-compact-cap-strip flex shrink-0 items-center justify-end gap-[3px]'
} as const

export const apiKeyListClasses = {
  shell: 'provider-settings-default-scope space-y-4',
  summaryMeta: 'text-xs text-foreground-muted tabular-nums',
  helperText: 'text-[13px] leading-[1.25] text-foreground-muted',
  listWrap: 'overflow-hidden rounded-lg border border-foreground/12 bg-transparent',
  listScroller: 'max-h-[60vh] overflow-x-hidden',
  keyRow: 'flex flex-col gap-2 border-b border-foreground/6 px-4 py-3 last:border-b-0',
  keyRowHeader: 'flex items-start justify-between gap-3',
  keyLabel: 'min-w-0 truncate text-[13px] leading-[1.25] text-foreground font-medium',
  keyValue: 'min-w-0 flex-1 truncate font-mono text-xs text-foreground-muted',
  keyInputRow: 'grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]',
  actionRow: 'flex items-center justify-between gap-3',
  actionCluster: 'flex items-center gap-1'
} as const

export const oauthCardClasses = {
  /** Fills the auth column; no max-width so the card tracks the detail pane (fluid layout). */
  container: 'w-full min-w-0',
  /** Aligned with `authConnectionClasses.shell`: `--section-border` hairline, `--radius-xl` (large card), no shadow / fill. */
  shell: 'w-full min-w-0 overflow-hidden rounded-xl border border-border px-3.5 py-3',
  loginFooterRow: 'mt-2.5 flex items-center justify-center gap-4',
  loginFooterLink:
    'h-auto min-h-0 p-0 text-xs text-muted-foreground/60 shadow-none hover:bg-transparent hover:text-foreground',
  loginFooterDivider: 'text-xs text-muted-foreground/50',
  /** CherryIN portal link — matches scoped caption + primary link treatment. */
  externalLink: 'mt-1 inline-block text-xs text-primary hover:underline',
  /** Logged-in CherryIN: mock CherryIN account section — one row, no stat grid. */
  shellLoggedIn: 'w-full min-w-0 overflow-hidden rounded-xl border border-border p-3.5',
  loggedInRow: 'flex w-full min-w-0 flex-wrap items-center justify-between gap-3',
  profileMeta: 'flex min-w-0 flex-1 items-center gap-3',
  /** Avatar: 32px round avatar, primary fill, initials (/ CherryIN row). */
  avatarSm:
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white',
  nameBlock: 'min-w-0',
  nameRow: 'flex flex-wrap items-center gap-1.5',
  name: 'truncate text-[15px] leading-[1.2] font-semibold tracking-tight text-foreground',
  /** Logged-in title line — `text-xs` in structured. */
  loggedInName: 'truncate text-xs font-medium leading-tight text-foreground',
  loggedInEmail: 'mt-0.5 truncate text-xs leading-[1.35] text-muted-foreground/40',
  badge:
    'inline-flex items-center rounded bg-[color:color-mix(in_srgb,var(--warning)_10%,transparent)] px-1 py-[0.5px] text-[10px] font-medium leading-tight text-[color:var(--warning)]',
  loggedInActions: 'flex shrink-0 flex-wrap items-center justify-end gap-2',
  inlineBalanceBlock: 'text-right',
  inlineBalanceLabel: 'text-xs text-muted-foreground/40',
  inlineBalanceValue: 'text-sm font-semibold leading-tight text-foreground tabular-nums',
  balanceValueSkeleton: 'inline-block w-20',
  /** CherryIN top-up CTA — solid primary background, white label (compact inline size). */
  topupPrimaryButton: 'h-auto min-h-0 px-2.5 py-[3px] text-xs shadow-none',
  logoutCompact:
    'h-auto min-h-0 rounded-md px-1.5 py-[3px] text-xs text-muted-foreground/30 shadow-none hover:bg-transparent hover:text-foreground',
  serviceAttribution: 'mt-2.5 border-t border-foreground/6 pt-2.5 text-xs text-muted-foreground/25',
  serviceLink: 'text-muted-foreground/40 transition-colors hover:text-foreground',
  actionsRow: 'flex flex-wrap items-center gap-2',
  footer: 'mt-4 text-[12px] leading-[1.35] text-foreground-muted'
} as const

/** Shared visual for provider-settings icon buttons (bordered, cherry-* hover); size is composed per usage. */
const fieldIconButtonBase =
  'flex shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

export const fieldClasses = {
  inputRow: 'flex min-w-0 items-center gap-1.5',
  /** Reserves 24×24 next to `inputGroup` in `inputRow` when there is no trailing action (aligns with `iconButton`). */
  inputRowEndSlot: 'inline-flex h-6 w-6 shrink-0',
  /** In a `inputRow` next to a 24px icon button */
  inputGroup: [
    'flex min-h-0 min-w-0 flex-1 items-center',
    providerSettingsInputGroupBase,
    providerSettingsInputGroupFocusOverride
  ].join(' '),
  /** Full-width field (no side icon) */
  inputGroupBlock: [
    'flex w-full items-center',
    providerSettingsInputGroupBase,
    providerSettingsInputGroupFocusOverride
  ].join(' '),
  /**
   * Matches connection row: body-md, full foreground, muted placeholder; flush in group.
   * Repeat `md:` so `InputGroupInput` defaults do not re-assert `md:text-sm` alone on the base layer.
   */
  input:
    'min-h-0 h-auto min-w-0 flex-1 border-0 bg-transparent p-0 shadow-none outline-none focus-visible:ring-0 ' +
    'text-base text-foreground ' +
    'placeholder:text-muted-foreground/60 md:text-base',
  /** Small 24px icon control (e.g. copy / inline settings) — for compact rows, not next to a full input. */
  iconButton: cn(fieldIconButtonBase, 'size-6'),
  /** 32px icon control that matches the connection input-group height (`h-8`) when placed beside it in an `inputRow`. */
  inputActionButton: cn(fieldIconButtonBase, 'size-8'),
  /** Inline show/hide control kept inside the field without adding another border. */
  apiKeyVisibilityToggle:
    'flex size-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
} as const
