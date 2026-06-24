// Primitive Components
export { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from './primitives/avatar'
export { default as CircularProgress, type CircularProgressProps } from './primitives/circular-progress'
export { default as CopyButton } from './primitives/copy-button'
export { default as CustomTag, type CustomTagProps } from './primitives/custom-tag'
export { Divider, type DividerProps } from './primitives/divider'
export { default as DividerWithText } from './primitives/divider-with-text'
export { default as EmojiIcon } from './primitives/emoji-icon'
export type { CustomFallbackProps, ErrorBoundaryCustomizedProps } from './primitives/error-boundary'
export { ErrorBoundary } from './primitives/error-boundary'
export { default as IndicatorLight } from './primitives/indicator-light'
export { type PortalContainer, PortalContainerProvider, usePortalContainer } from './primitives/portal-container'
export { default as Spinner } from './primitives/spinner'
export { DescriptionSwitch, Switch } from './primitives/switch'
export {
  NormalTooltip,
  Tooltip,
  TooltipContent,
  type TooltipProps,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger
} from './primitives/tooltip'

// Composite Components
export { ConfirmDialog, type ConfirmDialogProps } from './composites/confirm-dialog'
export {
  type ColumnDef,
  DataTable,
  type DataTableColumnMeta,
  type DataTableProps,
  type DataTableSelection
} from './composites/data-table'
export {
  type DateTimeGranularity,
  DateTimePicker,
  type DateTimePickerLabels,
  type DateTimePickerProps
} from './composites/date-time-picker'
export { default as Ellipsis } from './composites/ellipsis'
export { default as EmojiAvatar } from './composites/emoji-avatar'
export { EmptyState, type EmptyStatePreset, type EmptyStateProps } from './composites/empty-state'
export {
  type EntityItemBase,
  EntitySelector,
  type EntitySelectorContextMenuFactory,
  type EntitySelectorMultiSelect,
  type EntitySelectorPopoverContentProps,
  type EntitySelectorProps,
  type EntitySelectorRowContext,
  type EntitySelectorSearch,
  type EntitySelectorSection
} from './composites/entity-selector'
export { Box, Center, ColFlex, Flex, RowFlex, SpaceBetweenRowFlex } from './composites/flex'
export { default as HorizontalScrollContainer } from './composites/horizontal-scroll-container'
export {
  PageSidePanel,
  PageSidePanelItem,
  type PageSidePanelItemProps,
  type PageSidePanelPlacement,
  type PageSidePanelProps,
  PageSidePanelSection,
  type PageSidePanelSectionProps
} from './composites/page-side-panel'
export { default as Scrollbar } from './composites/scrollbar'
export { SearchInput, type SearchInputProps } from './composites/search-input'
export { SelectDropdown, type SelectDropdownProps } from './composites/select-dropdown'

// Icon Components — import from '@cherrystudio/ui/icons' path
export type { CompoundIcon, IconAvatarProps, IconComponent, IconMeta, IconProps } from './icons/types'

/* Additional Composite Components */
// CodeEditor
export {
  default as CodeEditor,
  type CodeEditorHandles,
  type CodeEditorProps,
  type CodeMirrorTheme,
  getCmThemeByName,
  getCmThemeNames
} from './composites/code-editor'
// DraggableList
export { DraggableList, useDraggableReorder } from './composites/draggable-list'
// EditableNumber
export type { EditableNumberProps } from './composites/editable-number'
export { default as EditableNumber } from './composites/editable-number'
export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField
} from './composites/form'
// Tooltip variants
export { HelpTooltip, type IconTooltipProps, InfoTooltip, WarnTooltip } from './composites/icon-tooltips'
// ImageToolButton
export { default as ImageToolButton } from './composites/image-tool-button'
// Markdown
export * from './composites/markdown'
// ImagePreview
export {
  DEFAULT_IMAGE_PREVIEW_LABELS,
  type ImagePreviewAction,
  type ImagePreviewActionContext,
  ImagePreviewContextMenu,
  type ImagePreviewContextMenuProps,
  ImagePreviewDialog,
  type ImagePreviewDialogProps,
  ImagePreviewImage,
  type ImagePreviewImageProps,
  type ImagePreviewItem,
  type ImagePreviewLabels,
  ImagePreviewToolbar,
  type ImagePreviewToolbarProps,
  type ImagePreviewTransform,
  type ImagePreviewTransformControls,
  type ImagePreviewTransformOptions,
  ImagePreviewTrigger,
  type ImagePreviewTriggerProps,
  useImagePreviewTransform
} from './composites/image-preview'
// MenuList
export type { MenuDividerProps, MenuItemProps, MenuListProps } from './composites/menu-list'
export { MenuDivider, MenuItem, menuItemVariants, MenuList } from './composites/menu-list'
// PageHeader
export { PageHeader, type PageHeaderProps } from './composites/page-header'
// ReorderableList
export { ReorderableList, type ReorderableListProps } from './composites/reorderable-list'
// Sortable
export {
  CompositeInput,
  type CompositeInputProps,
  type SelectGroup as CompositeInputSelectGroup,
  type SelectItem as CompositeInputSelectItem
} from './composites/composite-input'
export { Sortable } from './composites/sortable'
// TreeView
export {
  type DragPosition,
  flattenTree,
  type FlatTreeItem,
  type RenderRowArgs,
  type RenderRowFn,
  type TreeDragHandleProps,
  type TreeListSlotArgs,
  type TreeNodeAdapter,
  TreeView,
  type TreeViewProps,
  useExpandedState,
  useSelectionState,
  useTreeDragAndDrop
} from './composites/tree-view'

/* Shadcn Primitive Components */
export * from './primitives/accordion'
export * from './primitives/alert'
export * from './primitives/badge'
export * from './primitives/breadcrumb'
export * from './primitives/button'
export * from './primitives/button-group'
export * from './primitives/calendar'
export * from './primitives/checkbox'
export * from './primitives/combobox'
export * from './primitives/command'
export * from './primitives/context-menu'
export * from './primitives/dialog'
export * from './primitives/drawer'
export * from './primitives/dropdown-menu'
export * from './primitives/field'
export * from './primitives/hover-card'
export * from './primitives/input'
export * from './primitives/input-group'
export * from './primitives/item'
export * from './primitives/kbd'
export * from './primitives/label'
export * from './primitives/pagination'
export * from './primitives/popover'
export * from './primitives/radio-group'
export * from './primitives/resizable'
export * from './primitives/segmented-control'
export * from './primitives/select'
export * from './primitives/separator'
export * from './primitives/shadcn-io/dropzone'
export * from './primitives/skeleton'
export * from './primitives/slider'
export * from './primitives/table'
export * from './primitives/tabs'
export * as Textarea from './primitives/textarea'
export * from './primitives/toast'
export * from './primitives/tree-select'
