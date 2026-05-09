export const paintingClasses = {
  page: 'painting-theme flex h-full flex-1 flex-col',
  content: 'flex min-h-0 flex-1 flex-col overflow-hidden !bg-white dark:!bg-background',
  tabsWrap: 'flex justify-center px-6 pt-4 pb-3',
  tabsList:
    'rounded-full border border-border/60 bg-neutral-100 p-1 shadow-[var(--painting-surface-shadow)] backdrop-blur-sm dark:bg-muted/40',
  tabsTrigger:
    'rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground transition data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-background',
  frame: 'relative flex min-h-0 flex-1 overflow-hidden p-2',
  surface:
    'relative isolate flex min-w-0 flex-1 overflow-hidden rounded-[var(--painting-radius-surface)] bg-white dark:bg-background',
  centerPane: 'relative flex min-w-0 flex-1 flex-col overflow-hidden',
  panel:
    'painting-theme-portal flex h-full w-[var(--painting-panel-width)] shrink-0 flex-col overflow-hidden border-border/50 border-r bg-[var(--painting-panel-bg)]',
  panelHeader: 'flex items-center justify-between px-4 pt-3 pb-2',
  panelModelSelector: 'shrink-0 px-4 pb-3',
  panelModelSelectorTrigger:
    'h-9 w-full max-w-none justify-between rounded-xl border border-border/50 bg-background/70 px-3 hover:bg-muted/45',
  panelBody: 'flex min-h-0 flex-1 flex-col px-4 pb-4',
  panelScroll: '-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 pr-2',
  historyStrip:
    'flex h-full w-[68px] shrink-0 flex-col gap-2 overflow-y-auto border-border/50 border-l bg-white px-2 py-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden dark:bg-muted/10',
  historyAddButton:
    'sticky top-0 z-10 mb-1 flex h-9 w-11 shrink-0 items-center justify-center rounded-full bg-white text-muted-foreground hover:bg-[var(--painting-control-bg-hover)] hover:text-foreground dark:bg-background',
  historyItem:
    'group relative flex h-11 w-11 shrink-0 items-center justify-center overflow-visible rounded-[var(--painting-radius-item)] bg-[var(--painting-control-bg)] p-0 leading-none transition hover:bg-[var(--painting-control-bg-hover)]',
  historyItemActive: 'bg-white dark:bg-background',
  historyDelete:
    'absolute -top-1 -right-1 z-20 flex size-5 cursor-pointer items-center justify-center rounded-full border border-border/70 bg-white/95 text-destructive opacity-0 shadow-sm transition group-hover:opacity-100 dark:bg-background/95',
  promptModeTabsList: 'h-8 rounded-full border border-border/60 bg-muted/35 p-0.5 shadow-none dark:bg-muted/20',
  promptModeTabsTrigger:
    'h-7 rounded-full px-2.5 text-xs text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
  promptWrap: 'shrink-0 px-2 pb-4 pt-2',
  toolbarWrap: 'absolute top-4 left-4 z-20',
  toolbarRail:
    'flex items-center rounded-full border border-border/60 bg-white/90 p-1 shadow-[var(--painting-floating-shadow)] backdrop-blur-xl dark:bg-background/90',
  toolbarButton: 'rounded-full text-muted-foreground hover:bg-muted/55 hover:text-foreground',
  toolbarButtonActive: 'bg-muted text-foreground'
} as const
