// Primitive Components
export { Avatar, AvatarGroup, type AvatarProps, EmojiAvatar } from './primitives/Avatar'
export { default as CopyButton } from './primitives/copyButton'
export { default as CustomTag } from './primitives/customTag'
export { default as DividerWithText } from './primitives/dividerWithText'
export { default as EmojiIcon } from './primitives/emojiIcon'
export type { CustomFallbackProps, ErrorBoundaryCustomizedProps } from './primitives/ErrorBoundary'
export { ErrorBoundary } from './primitives/ErrorBoundary'
export { default as IndicatorLight } from './primitives/indicatorLight'
export { default as Spinner } from './primitives/spinner'
export { DescriptionSwitch, Switch } from './primitives/switch'
export { Tooltip, type TooltipProps } from './primitives/tooltip'

// Composite Components
export { default as Ellipsis } from './composites/Ellipsis'
export { default as ExpandableText } from './composites/ExpandableText'
export { Box, Center, ColFlex, Flex, RowFlex, SpaceBetweenRowFlex } from './composites/Flex'
export { default as HorizontalScrollContainer } from './composites/HorizontalScrollContainer'
export { default as ListItem } from './composites/ListItem'
export { default as MaxContextCount } from './composites/MaxContextCount'
export { default as Scrollbar } from './composites/Scrollbar'
export { default as ThinkingEffect } from './composites/ThinkingEffect'

// Icon Components
export { FilePngIcon, FileSvgIcon } from './icons/FileIcons'
export type { LucideIcon, LucideProps } from './icons/Icon'
export {
  CopyIcon,
  createIcon,
  DeleteIcon,
  EditIcon,
  OcrIcon,
  RefreshIcon,
  ResetIcon,
  ToolIcon,
  UnWrapIcon,
  VisionIcon,
  WebSearchIcon,
  WrapIcon
} from './icons/Icon'
export { default as SvgSpinners180Ring } from './icons/SvgSpinners180Ring'
export { default as ToolsCallingIcon } from './icons/ToolsCallingIcon'

// /* Selector Components */
// export { default as Selector } from './primitives/select'
// export { default as SearchableSelector } from './primitives/Selector/SearchableSelector'
// export type {
//   MultipleSearchableSelectorProps,
//   MultipleSelectorProps,
//   SearchableSelectorItem,
//   SearchableSelectorProps,
//   SelectorItem,
//   SelectorProps,
//   SingleSearchableSelectorProps,
//   SingleSelectorProps
// } from './primitives/Selector/types'

/* Additional Composite Components */
// CodeEditor
export {
  default as CodeEditor,
  type CodeEditorHandles,
  type CodeEditorProps,
  type CodeMirrorTheme,
  getCmThemeByName,
  getCmThemeNames
} from './composites/CodeEditor'
// CollapsibleSearchBar
export { default as CollapsibleSearchBar } from './composites/CollapsibleSearchBar'
// DraggableList
export { DraggableList, useDraggableReorder } from './composites/DraggableList'
// EditableNumber
export type { EditableNumberProps } from './composites/EditableNumber'
export { default as EditableNumber } from './composites/EditableNumber'
// Tooltip variants
export { HelpTooltip, type IconTooltipProps, InfoTooltip, WarnTooltip } from './composites/IconTooltips'
// ImageToolButton
export { default as ImageToolButton } from './composites/ImageToolButton'
// Sortable
export { Sortable } from './composites/Sortable'

/* Shadcn Primitive Components */
export * from './primitives/button'
export * from './primitives/checkbox'
export * from './primitives/combobox'
export * from './primitives/command'
export * from './primitives/dialog'
export * from './primitives/input'
export * from './primitives/popover'
export * from './primitives/radioGroup'
export * from './primitives/select'
export * from './primitives/shadcn-io/dropzone'
export * from './primitives/textarea'
