/**
 * Adapters wrapping @cherrystudio/ui components for the json-render registry.
 * json-render components receive { props, children, bindings, emit }.
 * We map these to the Cherry UI component APIs.
 *
 * Components not yet available in @cherrystudio/ui fall through to
 * @json-render/shadcn defaults via the spread in registry.tsx.
 */
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@cherrystudio/ui/components/primitives/accordion'
import { Avatar, AvatarFallback, AvatarImage } from '@cherrystudio/ui/components/primitives/avatar'
import { Badge } from '@cherrystudio/ui/components/primitives/badge'
import { Button } from '@cherrystudio/ui/components/primitives/button'
import { Checkbox } from '@cherrystudio/ui/components/primitives/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui/components/primitives/dialog'
import { Input } from '@cherrystudio/ui/components/primitives/input'
import { Label } from '@cherrystudio/ui/components/primitives/label'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious
} from '@cherrystudio/ui/components/primitives/pagination'
import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui/components/primitives/popover'
import { RadioGroup, RadioGroupItem } from '@cherrystudio/ui/components/primitives/radioGroup'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui/components/primitives/select'
import { Separator } from '@cherrystudio/ui/components/primitives/separator'
import { Slider } from '@cherrystudio/ui/components/primitives/slider'
import { Switch } from '@cherrystudio/ui/components/primitives/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui/components/primitives/tabs'
import { Tooltip, type TooltipProps } from '@cherrystudio/ui/components/primitives/tooltip'
import { useBoundProp, useFieldValidation } from '@json-render/react'
import { Loader } from 'lucide-react'
import { useState } from 'react'

// ── Simple display components (no Cherry UI equivalent, just HTML) ──

export const cherryComponents: Record<string, any> = {
  // ── Card (borderless, inline in message flow) ──
  Card: ({ props, children }: any) => (
    <div className="space-y-2">
      {(props.title || props.description) && (
        <div className="space-y-1">
          {props.title && <h3 className="font-semibold leading-tight tracking-tight">{props.title}</h3>}
          {props.description && <p className="text-muted-foreground text-sm">{props.description}</p>}
        </div>
      )}
      {children}
    </div>
  ),

  // ── Button ──
  Button: ({ props, emit }: any) => {
    const variant = props.variant === 'danger' ? 'destructive' : props.variant === 'secondary' ? 'secondary' : 'default'
    return (
      <Button variant={variant} disabled={props.disabled ?? false} onClick={() => emit('press')}>
        {props.label}
      </Button>
    )
  },

  // ── Badge ──
  Badge: ({ props }: any) => <Badge variant={props.variant ?? 'default'}>{props.text}</Badge>,

  // ── Separator ──
  Separator: ({ props }: any) => <Separator orientation={props.orientation ?? 'horizontal'} />,

  // ── Input ──
  Input: ({ props, bindings, emit }: any) => {
    const [boundValue, setBoundValue] = useBoundProp(props.value, bindings?.value)
    const [localValue, setLocalValue] = useState('')
    const isBound = !!bindings?.value
    const value = isBound ? (boundValue ?? '') : localValue
    const setValue = isBound ? setBoundValue : setLocalValue
    const validateOn = props.validateOn ?? 'blur'
    const hasValidation = !!(bindings?.value && props.checks?.length)
    const { errors, validate } = useFieldValidation(
      bindings?.value ?? '',
      hasValidation ? { checks: props.checks ?? [], validateOn } : undefined
    )
    return (
      <div className="space-y-2">
        {props.label && <Label htmlFor={props.name}>{props.label}</Label>}
        <Input
          id={props.name}
          name={props.name}
          type={props.type ?? 'text'}
          placeholder={props.placeholder ?? ''}
          value={value}
          onChange={(e: any) => {
            setValue(e.target.value)
            if (hasValidation && validateOn === 'change') validate()
          }}
          onKeyDown={(e: any) => {
            if (e.key === 'Enter') emit('submit')
          }}
          onFocus={() => emit('focus')}
          onBlur={() => {
            if (hasValidation && validateOn === 'blur') validate()
            emit('blur')
          }}
        />
        {errors.length > 0 && <p className="text-destructive text-sm">{errors[0]}</p>}
      </div>
    )
  },

  // ── Checkbox ──
  Checkbox: ({ props, bindings, emit }: any) => {
    const [checked, setChecked] = useBoundProp(props.checked, bindings?.checked)
    return (
      <div className="flex items-center space-x-2">
        <Checkbox
          id={props.name}
          checked={checked ?? false}
          onCheckedChange={(v: boolean) => {
            setChecked(v)
            emit('change')
          }}
        />
        {props.label && <Label htmlFor={props.name}>{props.label}</Label>}
      </div>
    )
  },

  // ── Switch ──
  Switch: ({ props, bindings, emit }: any) => {
    const [checked, setChecked] = useBoundProp(props.checked, bindings?.checked)
    return (
      <div className="flex items-center space-x-2">
        <Switch
          id={props.name}
          checked={checked ?? false}
          onCheckedChange={(v: boolean) => {
            setChecked(v)
            emit('change')
          }}
        />
        {props.label && <Label htmlFor={props.name}>{props.label}</Label>}
      </div>
    )
  },

  // ── Slider ──
  Slider: ({ props, bindings, emit }: any) => {
    const [value, setValue] = useBoundProp(props.value, bindings?.value)
    return (
      <div className="space-y-2">
        {props.label && <Label>{props.label}</Label>}
        <Slider
          min={props.min ?? 0}
          max={props.max ?? 100}
          step={props.step ?? 1}
          value={[value ?? props.min ?? 0]}
          onValueChange={(v: number[]) => {
            setValue(v[0])
            emit('change')
          }}
        />
      </div>
    )
  },

  // ── Select ──
  Select: ({ props, bindings, emit }: any) => {
    const [value, setValue] = useBoundProp(props.value, bindings?.value)
    return (
      <div className="space-y-2">
        {props.label && <Label>{props.label}</Label>}
        <Select
          value={value ?? ''}
          onValueChange={(v: string) => {
            setValue(v)
            emit('change')
          }}>
          <SelectTrigger>
            <SelectValue placeholder={props.placeholder ?? ''} />
          </SelectTrigger>
          <SelectContent>
            {(props.options ?? []).map((opt: string) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  },

  // ── Radio ──
  Radio: ({ props, bindings, emit }: any) => {
    const [value, setValue] = useBoundProp(props.value, bindings?.value)
    return (
      <div className="space-y-2">
        {props.label && <Label>{props.label}</Label>}
        <RadioGroup
          value={value ?? ''}
          onValueChange={(v: string) => {
            setValue(v)
            emit('change')
          }}>
          {(props.options ?? []).map((opt: string) => (
            <div key={opt} className="flex items-center space-x-2">
              <RadioGroupItem value={opt} id={`${props.name}-${opt}`} />
              <Label htmlFor={`${props.name}-${opt}`}>{opt}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    )
  },

  // ── Tabs ──
  Tabs: ({ props, children, bindings, emit }: any) => {
    const tabs = props.tabs ?? []
    const [value, setValue] = useBoundProp(props.value, bindings?.value)
    const [localValue, setLocalValue] = useState(props.defaultValue ?? tabs[0]?.value ?? '')
    const isBound = !!bindings?.value
    const activeValue = isBound ? (value ?? tabs[0]?.value ?? '') : localValue
    const setActiveValue = isBound ? setValue : setLocalValue

    return (
      <Tabs
        value={activeValue}
        onValueChange={(v: string) => {
          setActiveValue(v)
          emit('change')
        }}>
        <TabsList>
          {tabs.map((tab: any) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab: any, i: number) => (
          <TabsContent key={tab.value} value={tab.value}>
            {children?.[i]}
          </TabsContent>
        ))}
      </Tabs>
    )
  },

  // ── Accordion ──
  Accordion: ({ props }: any) => {
    const items = props.items ?? []
    return (
      <Accordion type={props.type === 'multiple' ? 'multiple' : 'single'} collapsible>
        {items.map((item: any, i: number) => (
          <AccordionItem key={i} value={`item-${i}`}>
            <AccordionTrigger>{item.title}</AccordionTrigger>
            <AccordionContent>{item.content}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    )
  },

  // ── Dialog ──
  Dialog: ({ props, children }: any) => {
    return (
      <Dialog open={props.open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            {props.description && <DialogDescription>{props.description}</DialogDescription>}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    )
  },

  // ── Avatar ──
  Avatar: ({ props }: any) => {
    const sizeClass = props.size === 'sm' ? 'h-8 w-8' : props.size === 'lg' ? 'h-12 w-12' : 'h-10 w-10'
    const initials = (props.name ?? '')
      .split(' ')
      .map((w: string) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
    return (
      <Avatar className={sizeClass}>
        {props.src && <AvatarImage src={props.src} alt={props.name} />}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
    )
  },

  // ── Pagination ──
  Pagination: ({ props, bindings, emit }: any) => {
    const [page, setPage] = useBoundProp(props.page, bindings?.page)
    const currentPage = page ?? 1
    return (
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => {
                if (currentPage > 1) {
                  setPage(currentPage - 1)
                  emit('change')
                }
              }}
            />
          </PaginationItem>
          <PaginationItem>
            <span className="px-3 py-1 text-sm">
              {currentPage} / {props.totalPages ?? 1}
            </span>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext
              onClick={() => {
                if (currentPage < (props.totalPages ?? 1)) {
                  setPage(currentPage + 1)
                  emit('change')
                }
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    )
  },

  // ── Popover ──
  Popover: ({ props }: any) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">{props.trigger}</Button>
      </PopoverTrigger>
      <PopoverContent>{props.content}</PopoverContent>
    </Popover>
  ),

  // ── Tooltip ──
  Tooltip: ({ props }: any) => (
    <Tooltip content={props.content as TooltipProps['content']}>
      <span>{props.text}</span>
    </Tooltip>
  ),

  // ── Spinner ──
  Spinner: ({ props }: any) => {
    const size = props.size === 'sm' ? 16 : props.size === 'lg' ? 32 : 24
    return (
      <div className="flex items-center gap-2">
        <Loader className="animate-spin" size={size} />
        {props.label && <span className="text-muted-foreground text-sm">{props.label}</span>}
      </div>
    )
  }
}
