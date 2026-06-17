import { cn } from '@renderer/utils'

/**
 * Provider settings — design alignment (scoped theme + composition)
 *
 * **Shell** — `ProviderSetting.tsx` wraps the detail column in `.provider-settings-default-scope`. Everything
 * that must follow the provider-settings surface must stay in that subtree so tokens and `--color-*` bridge apply.
 *
 * **Two layers**
 * - **CSS** — `assets/styles/provider-settings-scoped-theme.css`: atomic vars only (`--font-size-*`, `--space-*`, soft
 *   surfaces, `--color-*` → shadcn/Tailwind). No screen- or feature-prefixed names. When fixed pixels hurt a11y /
 *   readability, prefer named steps and note the tradeoff in a CSS comment.
 * - **TS (this file)** — merge atoms into `actionClasses`, `fieldClasses`, `modelListClasses`, `providerDetailColumnClasses`,
 *   `apiKeyListClasses`, …
 *   Use `var(--*)` in class strings; avoid scattered `text-[Npx]` and inline `fontWeight` styles.
 *
 * **Rules (short)** — Do not satisfy this page by editing global `:root` unless product wants a global change.
 * Figma “infinite” radius exports → `rounded-full` in UI. Secondary actions: `btnNeutral`, not brand primary fill,
 * unless the spec demands emphasis. Execution order: scope vars + bridge in CSS → extend `*Classes` → touch TSX.
 */
export const providerSettingsTypography = {
  menu: 'text-[length:var(--font-size-body-sm)] leading-[length:var(--line-height-body-sm)]',
  body: 'text-[length:var(--font-size-body-sm)] leading-[length:var(--line-height-body-sm)]',
  label: 'text-[length:var(--font-size-body-xs)] leading-[length:var(--line-height-body-xs)]',
  micro: 'text-[length:var(--font-size-body-xs)] leading-[length:var(--line-height-body-xs)]',
  caption: 'text-[length:var(--font-size-body-xs)] leading-[length:var(--line-height-body-xs)]',
  subtitle: 'text-[length:var(--font-size-body-md)] leading-[length:var(--line-height-body-md)]'
} as const

/**
 * Input row + icon slots for provider settings, using tokens from `provider-settings-scoped-theme.css`
 * (`.provider-settings-default-scope` — `--border`, `--foreground`, `--cherry-*`).
 * The provider detail shell should include `provider-settings-default-scope` so these inherit correctly.
 */
/** Connection — transparent input body + same muted border as model search.
 * Fixed `h-8` (32px) so all input groups in this page line up regardless of trailing-control height. */
const providerSettingsInputGroupBase =
  'h-8 rounded-lg border border-[color:var(--color-border-fg-muted)] bg-transparent px-2.5 shadow-none'

/** Softer focus ring than `@cherrystudio/ui` InputGroup default (`ring-[3px]`) — business-layer override only. */
const providerSettingsInputGroupFocusOverride =
  'has-[[data-slot=input-group-control]:focus-visible]:ring-[1px] has-[[data-slot=input-group-control]:focus-visible]:ring-ring/35'

/** Connection and `ProviderSection`: 14px, deepest foreground, section-label line-height. */
const sectionHeadingBase =
  'm-0 text-[length:var(--font-size-body-md)] text-foreground leading-[var(--line-height-section-label)]'

export const sectionHeadingClasses = cn(sectionHeadingBase, 'font-medium')

/** Authentication section layout: slot stack only; fields provide their own surfaces. */
export const authConnectionClasses = {
  shell: '',
  body: 'flex flex-col gap-2'
} as const

/**
 * Provider detail column (`ProviderSetting.tsx`) — padding + gap between Authentication + ModelList.
 */
export const providerDetailColumnClasses = {
  headerPad: 'shrink-0 px-6 pt-2',
  scrollStrip: 'min-h-0 flex-1 overflow-x-hidden px-6 pt-6 pb-4',
  contentMaxWidth: 'mx-auto w-full max-w-3xl',
  /** Header inner wrapper: same max-width as body content + bottom divider aligned to content edges. */
  headerContentMaxWidth: 'mx-auto w-full max-w-3xl border-b border-border pb-2',
  sectionStack: 'mx-auto flex min-h-full w-full min-w-0 max-w-3xl flex-col gap-5'
} as const

/** Connection-field actions; composes atomic `--space-*`, `--font-size-caption`, `--color-*-soft` from scope CSS. */
export const actionClasses = {
  row: 'flex flex-wrap items-center gap-[length:var(--space-inline-md)]',
  icon: 'size-[length:var(--icon-size-caption)] shrink-0',
  btnBase:
    'h-auto min-h-0 gap-2 rounded-[length:var(--radius-control)] px-[length:var(--padding-x-control)] py-[length:var(--padding-y-control)] text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] shadow-none',
  /** Neutral outline (design: action row — no brand fill on check / API-key-list actions). */
  btnNeutral:
    'border-[color:var(--color-border-default-soft)] bg-transparent text-[color:var(--color-fg-subtle)] hover:bg-[var(--accent)] hover:text-[color:var(--foreground)]'
} as const

const providerListItemFrame =
  'relative flex h-8 w-full items-center justify-between rounded-[10px] border border-transparent py-0 pr-2.5 pl-0.5 text-left shadow-none outline-none transition-colors focus-visible:ring-0'

/** Provider list rows + detached menus. */
export const providerListClasses = {
  shell: 'flex h-full w-[232px] shrink-0 basis-[232px] flex-col border-r border-[color:var(--section-border)]',
  headerIconButton:
    'flex size-6 shrink-0 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-[var(--color-surface-hover-soft)] hover:text-foreground/75 disabled:pointer-events-none disabled:opacity-30',
  headerAddButton:
    'flex size-7 shrink-0 items-center justify-center rounded-md text-primary transition-colors hover:bg-[var(--color-surface-hover-soft)] hover:text-primary disabled:pointer-events-none disabled:opacity-30',
  searchInlineAddButton:
    'flex size-[22px] shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-surface-hover-soft)] disabled:pointer-events-none disabled:opacity-30',
  searchRow: 'flex items-center gap-1.5 px-2.5 pb-2.5',
  searchWrap:
    'flex h-8 items-center gap-1 rounded-[10px] border border-[color:var(--section-border)] bg-background py-1 pl-2.5 pr-1',
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
  addWrap: 'shrink-0 border-t border-[color:var(--section-border)] px-2.5 py-2',
  addButton:
    'flex w-full items-center justify-center gap-1.5 rounded-lg border border-[color:var(--section-border)] border-dashed bg-transparent py-[5px] text-xs text-foreground-muted shadow-none transition-colors hover:border-[color:var(--color-border)] hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
  item: providerListItemFrame,
  itemSelected: 'bg-muted',
  itemIdle: 'hover:bg-muted',
  itemMain: 'flex min-w-0 flex-1 items-center gap-0',
  itemIdentity: 'flex min-w-0 flex-1 items-center gap-2.5',
  itemDragHandle:
    'flex w-2.5 shrink-0 items-center justify-center text-muted-foreground/40 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[dragging=true]:opacity-100',
  itemDragHandleSpacer: 'flex w-2.5 shrink-0',
  itemAvatar:
    'shrink-0 rounded-md border border-border/30 [&_[data-slot=avatar-fallback]]:rounded-[inherit] [&_[data-slot=avatar-image]]:rounded-[inherit]',
  itemLabel: 'truncate text-sm leading-[1.35] text-foreground font-[weight:500]',
  itemMenuContent: 'w-fit min-w-32 rounded-xl p-1.5',
  itemMenuEntry: 'h-8 rounded-lg px-2.5 text-sm',
  groupHeader: cn(providerListItemFrame, 'hover:bg-muted'),
  groupHeaderHasSelected: 'bg-muted',
  groupChevron: 'shrink-0 text-muted-foreground/60 transition-transform duration-150',
  groupChevronOpen: 'rotate-90',
  groupCount: 'shrink-0 text-[length:var(--font-size-body-xs)] leading-none text-muted-foreground/60 tabular-nums',
  groupBody: 'mt-1 flex flex-col gap-[var(--provider-list-row-gap)] pl-3.5',
  itemMoreActions:
    'absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-[color,opacity,background-color] hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 data-[active=true]:opacity-100',
  /** Enabled-state dot — shown when `provider.isEnabled` is true; hidden on row hover or focus so the kebab takes the slot. */
  itemEnabledDot:
    'pointer-events-none absolute right-[13px] top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-green-500 transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0',
  groupAddRow:
    'flex w-full items-center gap-2 rounded-[10px] border border-dashed border-[color:var(--section-border)] bg-transparent px-2 py-[6px] text-[length:var(--font-size-body-xs)] leading-[1.35] text-muted-foreground/70 shadow-none transition-colors hover:border-[color:var(--color-border)] hover:bg-accent/40 hover:text-foreground',
  disclosureToggle:
    'flex w-full items-center gap-1.5 rounded-md bg-transparent px-1 py-1 text-left text-[length:var(--font-size-body-xs)] leading-none text-muted-foreground/80 shadow-none outline-none transition-colors hover:text-foreground focus-visible:ring-0',
  disclosureChevron: 'size-3 shrink-0 text-muted-foreground/60 transition-transform duration-150',
  disclosureChevronOpen: 'rotate-90',
  disclosureBody: 'mt-2 flex flex-col gap-3 pl-1'
} as const

/**
 * — custom request headers side panel: one compact key/value row per header.
 */
export const customHeaderDrawerClasses = {
  bodyScroll: 'flex flex-col gap-4',
  /** JSON mode — matches structured monospace block for custom headers. */
  headersJsonEditor:
    'min-h-[120px] w-full resize-y rounded-xl border border-[color:var(--section-border)] bg-muted/50 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground shadow-none outline-none focus-visible:ring-[1px] focus-visible:ring-ring/35 placeholder:text-muted-foreground/45',
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
  sectionCard:
    'space-y-3.5 rounded-[length:var(--radius-lg)] border border-border bg-background px-3 py-3 text-foreground shadow-none',
  sectionDescription:
    'text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted',
  fieldList: 'space-y-3.5',
  field: 'space-y-1.5',
  fieldTitle:
    'font-[weight:var(--font-weight-medium)] text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)] text-foreground-secondary',
  input:
    'h-8 min-h-8 w-full rounded-[length:var(--radius-md)] border border-input bg-background px-3 py-1 text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)] text-foreground shadow-none outline-none transition-[border-color,box-shadow] placeholder:text-foreground-muted disabled:cursor-not-allowed disabled:opacity-60 focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/35',
  inputDisabled: 'bg-muted text-foreground-muted',
  selectTrigger:
    'h-auto w-full rounded-[length:var(--radius-md)] border-input bg-background px-3 py-2 text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)] text-foreground shadow-none data-[placeholder]:text-foreground-muted aria-expanded:border-ring aria-expanded:ring-[2px] aria-expanded:ring-ring/35',
  selectContent:
    'provider-settings-default-scope rounded-[length:var(--radius-lg)] border-[0.5px] border-border bg-popover text-popover-foreground shadow-lg',
  helpText: 'text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted',
  errorText: 'text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-destructive',
  emptyInline:
    'rounded-[length:var(--radius-md)] border border-dashed border-[color:var(--color-border-fg-muted)] px-3 py-2 text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-muted-foreground/70',
  toggleButton:
    'h-auto justify-start gap-1.5 px-0 py-0 text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)] text-foreground-muted shadow-none hover:bg-transparent hover:text-foreground',
  inlineRow: 'flex flex-wrap items-center gap-2',
  valueRow: 'flex min-w-0 items-center gap-2',
  responsiveValueRow: 'flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center',
  valueSuffix:
    'shrink-0 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted',
  divider: 'h-px bg-border-muted',
  switchCard:
    'rounded-[length:var(--radius-md)] border border-border bg-background px-3 py-3 [&_[data-slot=switch]]:mt-0.5',
  endpointChipRow: 'flex min-w-0 flex-wrap items-center gap-2',
  splitFooter: 'flex w-full items-center justify-between gap-3',
  footer: 'flex items-center justify-end gap-2',
  footerTextButton:
    'h-auto min-h-0 rounded-md px-0 py-0 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted/60 shadow-none hover:bg-transparent hover:text-foreground-muted',
  healthCostWarning:
    'shrink-0 rounded-[length:var(--radius-lg)] border-[color:var(--color-warning-base)] bg-[color:var(--color-warning-bg)] px-3 py-2.5 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-[color:var(--color-warning-base)] shadow-none [&_[data-slot=alert-icon]]:mt-0 [&_[data-slot=alert-icon]_svg]:size-4 [&_[data-slot=alert-message]]:font-[weight:var(--font-weight-medium)]',
  /** Model health-check drawer: determinate progress (scoped neutral track + primary fill). */
  healthProgressTrack:
    'h-1.5 w-full overflow-hidden rounded-full bg-[color:color-mix(in_srgb,var(--muted-foreground)_12%,transparent)]',
  healthProgressFill: 'h-full rounded-full bg-primary transition-[width] duration-300 ease-out',
  healthProgressMeta: 'text-[length:var(--font-size-caption)] tabular-nums text-muted-foreground/85',
  healthProgressCurrent: 'truncate text-[length:var(--font-size-caption)] text-foreground/80'
} as const

/** Model list block; composes atomic tokens from `provider-settings-scoped-theme.css` under `.provider-settings-default-scope`. */
export const modelListClasses = {
  /** Inline-size container for `@container model-list` rules in `provider-settings-scoped-theme.css` (replaces JS width measurement). */
  cqRoot: 'ps-model-list-cq flex h-full min-h-0 min-w-0 w-full flex-1 flex-col gap-[length:var(--space-stack-sm)]',
  section: 'flex h-full min-h-0 min-w-0 w-full flex-1 flex-col gap-[length:var(--space-stack-sm)]',
  headerBlock: 'flex min-h-0 min-w-0 w-full flex-1 flex-col gap-3',
  titleRow: 'flex min-w-0 w-full flex-wrap items-center justify-between gap-2.5',
  /** Model list header stack — matches model list block. */
  headerToolStack: 'flex min-w-0 w-full flex-col gap-2',
  titleWrap: 'flex w-full min-w-0 items-center gap-[length:var(--space-inline-md)]',
  titleActions: 'flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2',
  toolbarDesignIcon: 'size-4 shrink-0',
  /** Connected top-row model list actions; uses shared ButtonGroup + Button outline primitives. */
  toolbarButtonGroup: 'max-w-full shrink-0',
  /** Model-list section title: same size, line-height, and color; scoped weight `--font-weight-semibold` (600). */
  sectionTitleLine: 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1',
  sectionTitle: cn(sectionHeadingBase, 'shrink-0 whitespace-nowrap font-semibold'),
  titleHelpRow: 'flex min-w-0 flex-wrap items-center gap-x-1 self-center text-foreground-muted',
  titleHelpText: 'shrink-0 opacity-60',
  titleHelpLink:
    'mx-0 inline-flex shrink-0 items-center leading-[var(--line-height-section-label)] text-primary hover:underline',
  titleHelpSeparator:
    'inline-flex shrink-0 items-center leading-[var(--line-height-section-label)] text-foreground-muted/50',
  countMeta:
    'text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted tabular-nums',
  toolbarGhost:
    'h-auto rounded-3xs px-2.5 py-[5px] text-[length:var(--font-size-caption)] leading-[length:var(--line-height-caption)] text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-hover-soft)] hover:text-foreground',
  /** Model-list title-row ghost: one step tighter than `toolbarGhost` (padding + body-xs + small icon). */
  toolbarHeaderGhost:
    'h-auto min-h-0 rounded-[length:var(--radius-4xs)] px-[length:var(--padding-x-control-compact)] py-[length:var(--padding-y-control-compact)] text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground',
  toolbarHeaderIconButton:
    'size-8 rounded-[length:var(--radius-4xs)] p-0 text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground',
  toolbarIcon: 'size-[length:var(--icon-size-caption)] shrink-0',
  toolbarHeaderIcon: 'size-[length:var(--icon-size-body-xs)] shrink-0',
  searchExpandRow: 'flex min-w-0 w-full flex-wrap items-center gap-2',
  searchRow: 'flex min-w-0 w-full flex-wrap items-center gap-2',
  searchActions: 'flex max-w-full shrink-0 flex-wrap items-center gap-2',
  searchWrap:
    'flex h-8 min-w-0 flex-1 items-center gap-1 rounded-[10px] border border-[color:var(--color-border-fg-muted)] bg-background px-2.5 py-1',
  searchIcon: 'size-3 shrink-0 text-muted-foreground/65',
  searchInput:
    'min-w-0 flex-1 border-none bg-transparent text-sm leading-5 text-foreground/80 outline-none placeholder:text-muted-foreground/75 disabled:cursor-not-allowed disabled:opacity-60',
  searchClear:
    'flex h-[18px] w-[18px] items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground/65',
  fetchActionButton:
    'h-8 min-h-0 gap-1.5 rounded-[length:var(--cs-radius-md)] border-[color:var(--color-border-fg-muted)] bg-background px-2.5 py-0 text-sm leading-5 text-foreground shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5',
  addModelIconButton:
    'size-8 min-h-0 rounded-[length:var(--cs-radius-md)] border-[color:var(--color-border-fg-muted)] bg-background p-0 text-foreground shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5',
  addIconButton:
    'size-8 rounded-lg border-[color:var(--color-border-fg-muted)] bg-transparent text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground',
  capabilityFilterRoot: 'flex min-w-0 shrink-0 items-center gap-1',
  capabilityFilterButton:
    'h-7 min-h-0 max-w-[170px] gap-1.5 rounded-[length:var(--cs-radius-md)] border-[color:var(--color-border-fg-muted)] bg-background px-2 py-0 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground disabled:opacity-40',
  capabilityFilterButtonIconOnly: 'size-7 px-0',
  capabilityFilterButtonActive: 'border-[color:var(--color-border-active)] bg-[var(--color-surface-fg-subtle)]',
  capabilityFilterLabel: 'min-w-0 truncate',
  capabilityFilterClear:
    'inline-flex size-5 min-h-0 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground/45 transition-colors hover:bg-[var(--color-surface-fg-subtle)] hover:text-muted-foreground/80',
  capabilityFilterMenu: 'w-fit min-w-40 rounded-xl p-1.5',
  capabilityFilterMenuItem: 'h-8 rounded-lg px-2.5 text-sm',
  capabilityTabIcon: 'size-3 shrink-0',
  subsectionRow: 'flex min-w-0 items-center gap-2 px-1',
  subsectionTitleWrap: 'flex min-w-0 items-center gap-2',
  subsectionActions: 'ml-1 flex shrink-0 items-center gap-2',
  subsectionIconButton:
    'inline-flex size-5 min-h-0 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground/80 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground disabled:opacity-40',
  subsectionIcon: 'size-4 shrink-0',
  listActionTriggerButton:
    'inline-flex size-6 min-h-0 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground/55 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground/80 disabled:opacity-40',
  listActionTriggerIcon: 'size-4 shrink-0',
  listActionMenu: 'w-fit min-w-40 rounded-xl p-1.5',
  listActionMenuItem: 'h-9 rounded-lg px-3 text-sm',
  listActionMenuIcon: 'size-3.5 text-muted-foreground/70',
  subsectionTooltipTrigger: 'inline-flex size-5 min-h-0 shrink-0 items-center justify-center leading-none',
  subsectionTitleEnabled:
    'text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)] text-foreground font-[weight:var(--font-weight-semibold)]',
  subsectionCountEnabled:
    'text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)] text-foreground-muted tabular-nums font-[weight:var(--font-weight-medium)]',
  subsectionTitleDisabled:
    'text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)] text-foreground font-[weight:var(--font-weight-semibold)]',
  subsectionCountDisabled:
    'text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)] text-foreground-muted tabular-nums font-[weight:var(--font-weight-medium)]',
  emptyState:
    'flex min-h-40 items-center justify-center rounded-2xl border border-(--color-border) border-dashed bg-[var(--color-surface-fg-sunken)] px-4 text-center text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground-muted',
  listScroller: 'min-h-0 min-w-0 w-full flex-1 overflow-x-hidden pr-1',
  /**
   * — grouped catalog inside manage drawer (flat headers, no collapse).
   */
  manageListGroupShell: 'mb-1',
  manageListGroupHeader: 'flex items-center gap-1.5 px-1 py-[3px]',
  manageListGroupTitle:
    'font-[weight:var(--font-weight-medium)] text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted',
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
    'shrink-0 rounded-full bg-muted/50 px-1.5 py-[1px] text-[length:var(--font-size-body-xs)] text-muted-foreground/60 tabular-nums',
  /** Trailing close in manage drawer title row (paired with bulk actions); matches `hover:bg-accent`. */
  manageDrawerCloseInTitle:
    "ml-1 !size-6 !min-h-6 shrink-0 gap-0 rounded-[length:var(--radius-control)] p-0 text-muted-foreground/60 shadow-none hover:bg-accent hover:text-foreground [&_svg:not([class*='size-'])]:size-[11px]",
  manageDrawerBulkGhost:
    'inline-flex !h-auto !min-h-0 items-center justify-center gap-1 rounded-[length:var(--radius-control)] px-1.5 py-[2px] text-[length:var(--font-size-body-xs)] font-medium tracking-[-0.14px] text-muted-foreground/60 shadow-none transition-colors hover:bg-accent has-[>svg]:px-1.5',
  /** Enable-all hover — brand `--primary` in this shell (design `hover:text-cherry-primary`). */
  manageDrawerBulkGhostEnableHover: 'hover:!text-primary',
  /** Disable-all hover — destructive (design draft). */
  manageDrawerBulkGhostDisableHover: 'hover:!text-destructive',
  /** Provider-grouped card: bordered shell with leading chevron; rows render inside the same card on expand. */
  groupCard:
    'group/modelGroup min-w-0 w-full rounded-[length:var(--radius-md)] border border-[color:var(--color-border-fg-hairline)] bg-transparent px-2 py-1',
  groupHeader:
    'group/groupRow flex min-h-7 w-full items-center justify-between gap-2 bg-transparent text-left outline-none focus-visible:outline-none',
  groupToggleButton:
    'flex min-w-0 flex-1 items-center gap-1 bg-transparent text-left outline-none focus-visible:outline-none',
  groupHeaderActions: 'flex h-6 shrink-0 items-center gap-1',
  groupSwitchTooltipTrigger: 'inline-flex h-6 shrink-0 items-center justify-center leading-none',
  groupTitle:
    'min-w-0 flex-1 truncate text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)] text-foreground font-[weight:var(--font-weight-medium)]',
  groupChevron:
    'size-4 shrink-0 text-muted-foreground/65 transition-[transform,color] duration-150 group-hover/groupRow:text-foreground',
  groupChevronOpen: 'rotate-90',
  groupBody: 'mt-0.5 flex flex-col gap-0.5',
  groupOverflowHint:
    'mt-1 rounded-lg px-3 py-2 text-left text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-muted-foreground/70 transition-colors hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground',
  row: 'group flex min-h-11 items-center gap-3 py-2 text-foreground leading-none',
  rowMain: 'min-w-0 flex-1 items-center gap-3 self-center',
  rowAvatar: 'h-[26px] w-[26px] shrink-0 rounded-lg',
  rowBody: 'flex min-w-0 max-w-full flex-1 items-center overflow-hidden',
  /** Model name opens the edit drawer; the settings icon is the explicit secondary action. */
  rowNameCopyable: 'cursor-pointer',
  /** Shown when model id !== name; hidden in narrow container via `.ps-model-list-id` rule. */
  modelIdBadge:
    'ps-model-list-id min-w-0 max-w-[50%] shrink truncate rounded-md bg-foreground/[0.05] px-1.5 py-[1px] font-mono text-[length:var(--font-size-body-xs)] text-foreground-muted leading-[var(--line-height-body-xs)]',
  rowBadges: 'mt-1 flex min-h-[18px] min-w-0 max-w-full flex-wrap items-center gap-1.5',
  /** Capability / trial tags to the left of the enable switch; design: single line with the toggle. */
  rowCapabilityStrip:
    'flex h-7 min-w-0 max-w-[min(100%,20rem)] shrink items-center gap-1.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
  /** Wraps `ModelTagsWithLabel` only; pairs with `.ps-model-list-cap-strip` rules in `provider-settings-scoped-theme.css`. */
  rowCapabilityTagCluster: 'ps-compact-cap-strip flex min-w-0 shrink items-center',
  rowMeta:
    'ps-model-list-meta mt-[3px] block min-w-0 max-w-full truncate text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/65',
  /** Wraps `HealthStatusIndicator` so latency (antd Typography) can be hidden via container query. */
  healthStatusSlot: 'ps-model-list-health shrink-0',
  /** Trailing column: health + (capability strip + enable) on one row. */
  rowActionsCluster: 'flex min-h-7 min-w-0 items-center gap-2',
  rowActions: 'min-w-0 shrink-0 items-center gap-1.5 self-center',
  rowIconButton:
    'size-7 rounded-lg border border-[color:var(--color-border-fg-muted)] bg-transparent text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground'
} as const

export const modelSyncClasses = {
  panel: 'provider-settings-default-scope flex min-h-0 flex-1 flex-col gap-4',
  summaryCard:
    'rounded-2xl border border-[color:var(--color-border-fg-muted)] bg-[var(--color-surface-fg-sunken)] px-4 py-3',
  summaryTitle:
    'text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground/85 font-[weight:var(--font-weight-medium)]',
  summaryMeta: 'text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-muted-foreground/75',
  summaryGrid: 'mt-3 grid gap-2 sm:grid-cols-3',
  summaryMetric:
    'rounded-xl border border-[color:var(--color-border-fg-hairline)] bg-background/75 px-3 py-2 text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-foreground/75',
  warningBlock:
    'rounded-2xl border border-[color:var(--color-border-warning-soft)] bg-[var(--color-surface-warning-soft)] px-4 py-3 text-[length:var(--font-size-caption)] leading-[var(--line-height-body-md)] text-foreground/80',
  section: 'rounded-2xl border border-[color:var(--color-border-fg-muted)] bg-background px-4 py-4 shadow-none',
  sectionHeader: 'flex flex-wrap items-center justify-between gap-3',
  sectionTitleWrap: 'min-w-0',
  sectionTitle:
    'text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground/85 font-[weight:var(--font-weight-medium)]',
  sectionMeta: 'text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-muted-foreground/75',
  sectionActions: 'flex flex-wrap items-center gap-2',
  toggleButton: cn(
    actionClasses.btnBase,
    actionClasses.btnNeutral,
    'rounded-lg border-(--color-border-fg-muted) px-3 py-1.25 text-foreground/70 hover:bg-(--color-surface-fg-subtle) hover:text-foreground'
  ),
  list: 'mt-4 space-y-2',
  row: 'flex items-start gap-3 rounded-xl border border-[color:var(--color-border-fg-hairline)] bg-[var(--color-surface-fg-sunken)] px-3 py-3',
  rowBody: 'min-w-0 flex-1',
  rowTitle: 'truncate text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground/85',
  rowMeta: 'mt-1 text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-muted-foreground/75',
  rowBadgeRow: 'mt-2 flex flex-wrap items-center gap-1.5',
  rowBadge:
    'rounded-full border border-[color:var(--color-border-fg-muted)] bg-background px-2 py-0.5 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/65',
  rowDangerBadge:
    'rounded-full border border-[color:var(--color-border-warning-soft)] bg-[var(--color-surface-warning-soft)] px-2 py-0.5 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/75',
  impactCard:
    'rounded-2xl border border-[color:var(--color-border-info-soft)] bg-[var(--color-surface-info-soft)] px-4 py-4',
  impactList: 'mt-3 space-y-2',
  impactItem:
    'rounded-xl border border-[color:var(--color-border-fg-hairline)] bg-background/80 px-3 py-2 text-[length:var(--font-size-caption)] leading-[var(--line-height-body-md)] text-foreground/78',
  emptyState:
    'rounded-2xl border border-dashed border-[color:var(--color-border-fg-muted)] bg-[var(--color-surface-fg-sunken)] px-4 py-8 text-center text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-muted-foreground/75',
  footer: 'flex items-center justify-end gap-2',
  /** pull preview panel — pull result side panel */
  fetchEmpty: 'flex flex-col items-center justify-center px-4 py-12 text-center',
  fetchEmptyIconWrap: 'mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted',
  fetchEmptyIcon: 'size-4 text-foreground-muted',
  fetchEmptyTitle:
    'font-[weight:var(--font-weight-medium)] text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-secondary',
  fetchEmptyDescription:
    'mt-1 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted',
  fetchSection: 'min-w-0',
  fetchSectionHeader: 'mb-2.5 flex items-center justify-between gap-3',
  fetchSectionTitleRow: 'flex items-center gap-1.5',
  fetchDotNew: 'h-[6px] w-[6px] shrink-0 rounded-full bg-primary',
  fetchDotRemoved: 'h-[6px] w-[6px] shrink-0 rounded-full bg-destructive',
  fetchSectionTitle:
    'text-[length:var(--font-size-body-sm)] font-[weight:var(--font-weight-medium)] text-foreground leading-[var(--line-height-body-sm)]',
  fetchSectionCount:
    'text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted tabular-nums',
  fetchGhostAll:
    'inline-flex !h-auto !min-h-0 items-center justify-center rounded-[length:var(--radius-control)] px-2 py-[3px] !text-[length:var(--font-size-body-xs)] !leading-none text-foreground-muted shadow-none hover:bg-accent hover:text-foreground',
  fetchGhostAllRemoved:
    'inline-flex !h-auto !min-h-0 items-center justify-center rounded-[length:var(--radius-control)] px-2 py-[3px] !text-[length:var(--font-size-body-xs)] !leading-none text-foreground-muted shadow-none hover:bg-destructive/10 hover:text-destructive',
  fetchList: 'space-y-1',
  fetchWarning:
    'my-2 gap-2 rounded-[length:var(--radius-lg)] border-[color:color-mix(in_srgb,var(--color-warning-base)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--color-warning-bg)_52%,transparent)] px-2.5 py-2 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] shadow-none [&_[data-slot=alert-icon]]:mt-0 [&_[data-slot=alert-icon]_svg]:size-3.5 [&_[data-slot=alert-message]]:font-normal',
  fetchRowNew:
    'flex min-h-11 cursor-pointer items-center gap-2 rounded-[length:var(--radius-lg)] border border-transparent px-2.5 py-2 transition-colors hover:border-border/60 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/30 data-[checked=true]:border-border/40 data-[checked=true]:bg-background',
  fetchRowRemoved:
    'flex min-h-11 cursor-pointer items-center gap-2 rounded-[length:var(--radius-lg)] border border-transparent px-2.5 py-2 transition-colors hover:border-destructive/15 hover:bg-destructive/[0.03] focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/30 data-[checked=true]:border-destructive/15 data-[checked=true]:bg-background',
  fetchAvatar:
    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted font-medium text-[length:var(--font-size-body-xs)] leading-none text-foreground-muted',
  fetchRowTitle:
    'truncate text-[length:var(--font-size-body-sm)] font-[weight:var(--font-weight-medium)] leading-[var(--line-height-body-xs)] text-foreground',
  fetchRowTitleStrike:
    'truncate text-[length:var(--font-size-body-sm)] font-[weight:var(--font-weight-medium)] leading-[var(--line-height-body-xs)] text-foreground-muted line-through decoration-foreground-muted',
  fetchRowId:
    'mt-0.5 truncate font-mono text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted',
  fetchRowIdStrike:
    'mt-0.5 truncate font-mono text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted/70',
  fetchContextValue:
    'shrink-0 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted tabular-nums',
  /** Trailing capability icons — pull preview panel strip */
  fetchCapabilityStrip: 'ps-compact-cap-strip flex shrink-0 items-center justify-end gap-[3px]'
} as const

export const apiKeyListClasses = {
  summaryMeta:
    'text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted tabular-nums',
  helperText: 'text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-foreground-muted',
  listWrap: 'overflow-hidden rounded-lg border border-[color:var(--color-border-fg-muted)]',
  listScroller: 'max-h-[60vh] overflow-x-hidden',
  keyRow: 'flex flex-col gap-2 border-b border-[color:var(--color-border-fg-hairline)] px-4 py-3 last:border-b-0',
  keyDisplayRow: 'flex min-w-0 items-center gap-3',
  keyTextBlock: 'min-w-0 flex-1',
  keyRowActions: 'flex shrink-0 items-center gap-1.5',
  keyLabel:
    'min-w-0 truncate text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-foreground font-[weight:var(--font-weight-medium)]',
  keyValue:
    'min-w-0 flex-1 truncate font-mono text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground-muted',
  keyDraftRow: 'flex min-w-0 items-center gap-2',
  keyDraftInputs: 'grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(4.5rem,6rem)_minmax(0,1fr)]',
  keyDraftInput:
    'h-8 rounded-[length:var(--radius-md)] bg-background px-2.5 text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)]',
  keyIconButton:
    'inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-[var(--color-surface-fg-subtle)] hover:text-muted-foreground/70 disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3',
  keySaveIconButton:
    'inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-success/10 hover:text-success disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3',
  keyDestructiveIconButton:
    'inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive/70 disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3',
  actionRow: 'flex items-center justify-between gap-3'
} as const

export const oauthCardClasses = {
  /** Fills the auth column; no max-width so the card tracks the detail pane (fluid layout). */
  container: 'w-full min-w-0',
  /** Large bordered auth card, no shadow or filled background. */
  shell:
    'w-full min-w-0 overflow-hidden rounded-[length:var(--radius-xl)] border border-[color:var(--color-border-fg-hairline)] px-3 py-2.5',
  loginFooterRow: 'mt-2.5 flex items-center justify-center gap-4',
  loginFooterLink:
    'h-auto min-h-0 p-0 text-[length:var(--font-size-body-xs)] text-muted-foreground/60 shadow-none hover:bg-transparent hover:text-foreground',
  loginFooterDivider: 'text-[length:var(--font-size-body-xs)] text-muted-foreground/50',
  /** CherryIN portal link — matches scoped caption + primary link treatment. */
  externalLink:
    'mt-1 inline-block text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-primary hover:underline',
  /** Logged-in CherryIN: mock CherryIN account section — one row, no stat grid. */
  shellLoggedIn:
    'w-full min-w-0 overflow-hidden rounded-[length:var(--radius-xl)] border border-[color:var(--color-border-fg-hairline)] px-3 py-2.5',
  loggedInRow: 'flex w-full min-w-0 flex-wrap items-center justify-between gap-3',
  profileMeta: 'flex min-w-0 flex-1 items-center gap-3',
  /** Avatar: 32px round avatar, primary fill, initials (/ CherryIN row). */
  avatarSm:
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-[weight:var(--font-weight-semibold)] text-white',
  nameBlock: 'min-w-0',
  nameRow: 'flex flex-wrap items-center gap-1.5',
  name: 'truncate text-[15px] leading-[1.2] font-semibold tracking-tight text-foreground',
  /** Logged-in title line — `text-xs` in structured. */
  loggedInName:
    'truncate text-[length:var(--font-size-body-xs)] font-[weight:var(--font-weight-medium)] leading-tight text-foreground',
  loggedInEmail: 'mt-0.5 truncate text-[length:var(--font-size-body-xs)] leading-[1.35] text-muted-foreground/40',
  badge:
    'inline-flex items-center rounded bg-[color:color-mix(in_srgb,var(--warning)_10%,transparent)] px-1 py-[0.5px] text-[10px] font-[weight:var(--font-weight-medium)] leading-tight text-[color:var(--warning)]',
  loggedInActions: 'flex shrink-0 flex-wrap items-center justify-end gap-2',
  inlineBalanceBlock: 'text-right',
  inlineBalanceLabel: 'text-[length:var(--font-size-body-xs)] text-muted-foreground/40',
  inlineBalanceValue: 'text-sm font-semibold leading-tight text-foreground tabular-nums',
  balanceValueSkeleton: 'inline-block w-20',
  /** CherryIN top-up CTA — solid primary background, white label (compact inline size). */
  topupPrimaryButton: 'h-auto min-h-0 px-2.5 py-[3px] text-xs shadow-none',
  logoutCompact:
    'h-auto min-h-0 rounded-md px-1.5 py-[3px] text-xs text-muted-foreground/30 shadow-none hover:bg-transparent hover:text-foreground',
  serviceAttribution:
    'mt-2.5 border-t border-[color:var(--color-border-fg-hairline)] pt-2.5 text-[length:var(--font-size-body-xs)] text-muted-foreground/25',
  serviceLink: 'text-muted-foreground/40 transition-colors hover:text-foreground',
  actionsRow: 'flex flex-wrap items-center gap-2',
  footer: 'mt-4 text-[12px] leading-[1.35] text-foreground-muted'
} as const

/** Shared visual for provider-settings icon buttons (bordered, cherry-* hover); size is composed per usage. */
const fieldIconButtonBase =
  'flex shrink-0 items-center justify-center rounded-lg border border-[var(--cherry-active-border)] text-[var(--cherry-text-muted)] transition-colors hover:bg-[var(--cherry-active-bg)] hover:text-[var(--cherry-primary-hover)] disabled:pointer-events-none disabled:opacity-40'

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
    'text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground ' +
    'placeholder:text-muted-foreground/60 md:text-[length:var(--font-size-body-md)]',
  /** Small 24px icon control (e.g. copy / inline settings) — for compact rows, not next to a full input. */
  iconButton: cn(fieldIconButtonBase, 'size-6'),
  /** 32px icon control that matches the connection input-group height (`h-8`) when placed beside it in an `inputRow`. */
  inputActionButton: cn(fieldIconButtonBase, 'size-8'),
  /** Inline show/hide control kept inside the field without adding another border. */
  apiKeyVisibilityToggle:
    'flex size-5 shrink-0 items-center justify-center text-[var(--cherry-text-muted)] transition-colors hover:text-[var(--cherry-primary-hover)] disabled:pointer-events-none disabled:opacity-40',
  titleWithHelp: 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1',
  titleHelpLink:
    'mx-0 inline-flex shrink-0 items-center leading-[var(--line-height-body-sm)] text-primary hover:underline'
} as const
