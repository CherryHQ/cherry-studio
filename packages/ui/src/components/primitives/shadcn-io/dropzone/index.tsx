'use client'

import { Button } from '@cherrystudio/ui/components/primitives/button'
import { cn } from '@cherrystudio/ui/utils/index'
import { UploadIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { createContext, use } from 'react'
import type { DropEvent, DropzoneOptions, FileRejection } from 'react-dropzone'
import { useDropzone } from 'react-dropzone'

type DropzoneContextType = {
  src?: File[]
  accept?: DropzoneOptions['accept']
  maxSize?: DropzoneOptions['maxSize']
  minSize?: DropzoneOptions['minSize']
  maxFiles?: DropzoneOptions['maxFiles']
}

const renderBytes = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(2)}${units[unitIndex]}`
}

const DropzoneContext = createContext<DropzoneContextType | undefined>(undefined)

export type DropzoneProps = Omit<DropzoneOptions, 'onDrop'> & {
  src?: File[]
  className?: string
  onDrop?: (acceptedFiles: File[], fileRejections: FileRejection[], event: DropEvent) => void
  children?: ReactNode
}

export const Dropzone = ({
  accept,
  maxFiles = 1,
  maxSize,
  minSize,
  onDrop,
  onError,
  disabled,
  src,
  className,
  children,
  ...props
}: DropzoneProps) => {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    maxFiles,
    maxSize,
    minSize,
    onError,
    disabled,
    onDrop: (acceptedFiles, fileRejections, event) => {
      if (fileRejections.length > 0) {
        const message = fileRejections.at(0)?.errors.at(0)?.message
        onError?.(new Error(message))
        return
      }

      onDrop?.(acceptedFiles, fileRejections, event)
    },
    ...props
  })

  return (
    <DropzoneContext key={JSON.stringify(src)} value={{ src, accept, maxSize, minSize, maxFiles }}>
      <Button
        className={cn(
          'relative h-auto w-full flex-col overflow-hidden p-8',
          isDragActive && 'outline-none ring-1 ring-ring',
          className
        )}
        disabled={disabled}
        type="button"
        variant="outline"
        {...getRootProps()}>
        <input {...getInputProps()} disabled={disabled} />
        {children}
      </Button>
    </DropzoneContext>
  )
}

const useDropzoneContext = () => {
  const context = use(DropzoneContext)

  if (!context) {
    throw new Error('useDropzoneContext must be used within a Dropzone')
  }

  return context
}

export type DropzoneContentProps = {
  children?: ReactNode
  className?: string
}

const maxLabelItems = 3

export const DropzoneContent = ({ children, className }: DropzoneContentProps) => {
  const { src } = useDropzoneContext()

  if (!src) {
    return null
  }

  if (children) {
    return children
  }

  return (
    <div className={cn('flex flex-col items-center justify-center', className)}>
      <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <UploadIcon size={16} />
      </div>
      <p className="my-2 w-full truncate font-medium text-sm">
        {src.length > maxLabelItems
          ? `${new Intl.ListFormat('en').format(
              src.slice(0, maxLabelItems).map((file) => file.name)
            )} and ${src.length - maxLabelItems} more`
          : new Intl.ListFormat('en').format(src.map((file) => file.name))}
      </p>
      <p className="w-full text-wrap text-muted-foreground text-xs">Drag and drop or click to replace</p>
    </div>
  )
}

export type DropzoneEmptyStateProps = {
  children?: ReactNode
  className?: string
}

export const DropzoneEmptyState = ({ children, className }: DropzoneEmptyStateProps) => {
  const { src, accept, maxSize, minSize, maxFiles } = useDropzoneContext()

  if (src) {
    return null
  }

  if (children) {
    return children
  }

  let caption = ''

  if (accept) {
    caption += 'Accepts '
    caption += new Intl.ListFormat('en').format(Object.keys(accept))
  }

  if (minSize && maxSize) {
    caption += ` between ${renderBytes(minSize)} and ${renderBytes(maxSize)}`
  } else if (minSize) {
    caption += ` at least ${renderBytes(minSize)}`
  } else if (maxSize) {
    caption += ` less than ${renderBytes(maxSize)}`
  }

  return (
    <div className={cn('flex flex-col items-center justify-center', className)}>
      <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <UploadIcon size={16} />
      </div>
      <p className="my-2 w-full truncate text-wrap font-medium text-sm">Upload {maxFiles === 1 ? 'a file' : 'files'}</p>
      <p className="w-full truncate text-wrap text-muted-foreground text-xs">Drag and drop or click to upload</p>
      {caption && <p className="text-wrap text-muted-foreground text-xs">{caption}.</p>}
    </div>
  )
}
