export const paintingClasses = {
  page: 'flex h-full flex-1 flex-col',
  content: 'flex min-h-0 flex-1 flex-col overflow-hidden bg-background',
  tabsWrap: 'shrink-0 flex justify-center px-6 pt-3 pb-2',
  tabsList: 'rounded-full border border-border-muted bg-neutral-100 p-1 shadow-sm backdrop-blur-sm dark:bg-muted/40',
  tabsTrigger:
    'rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground transition data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-background',
  frame: 'relative flex min-h-0 flex-1 overflow-hidden px-2 pt-2 pb-1',
  surface: 'relative isolate flex min-w-0 flex-1 overflow-hidden rounded-none bg-background',
  centerPane: 'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
  /** Fills space between mode tabs and prompt; keeps canvas in the flex-shrink chain. */
  centerStage: 'flex min-h-0 min-w-0 flex-1 flex-col',
  /** Pins the prompt visually to the bottom of the middle column. */
  promptDock: 'shrink-0 border-border-muted border-t bg-background px-2 pt-2 pb-2',
  panel: 'flex h-full w-[260px] shrink-0 flex-col overflow-hidden border-border-subtle border-r bg-background',
  panelModelSelector: 'shrink-0 px-4 pt-3 pb-3',
  panelModelSelectorTrigger:
    'h-9 w-full max-w-none justify-between rounded-xl border border-border-subtle bg-background/70 px-3 hover:bg-muted/45',
  panelBody: 'flex min-h-0 flex-1 flex-col px-4 pb-4',
  panelScroll: '-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 pr-2',
  historyStrip:
    'flex h-full w-[68px] shrink-0 flex-col gap-2 overflow-y-auto border-border-subtle border-l bg-background px-2 py-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
  historyAddButton:
    'sticky top-0 z-10 mb-1 flex h-9 w-11 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground hover:bg-secondary-hover hover:text-foreground',
  historyItem:
    'group relative flex h-11 w-11 shrink-0 items-center justify-center overflow-visible rounded-[12px] bg-secondary p-0 leading-none transition hover:bg-secondary-hover',
  historyItemActive: 'bg-background',
  historyDelete:
    'absolute -top-1 -right-1 z-20 flex size-5 cursor-pointer items-center justify-center rounded-full border border-border-muted bg-white/95 text-destructive opacity-0 shadow-sm transition group-hover:opacity-100 dark:bg-background/95',
  promptModeTabsList: 'h-8 rounded-full border border-border-muted bg-muted/35 p-0.5 shadow-none dark:bg-muted/20',
  promptModeTabsTrigger:
    'h-7 rounded-full px-2.5 text-xs text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
  promptWrap: 'shrink-0 px-2 pb-4 pt-2',
  toolbarWrap: 'absolute top-4 left-4 z-20',
  toolbarRail:
    'flex items-center rounded-full border border-border-muted bg-background/90 p-1 shadow-md backdrop-blur-xl',
  toolbarButton: 'rounded-full text-muted-foreground hover:bg-muted/55 hover:text-foreground',
  toolbarButtonActive: 'bg-muted text-foreground'
} as const
