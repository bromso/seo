"use client"

import { Icon } from "@iconify/react"
import { FormControl } from "@repo/ui/components/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { cn } from "@repo/ui/lib/utils"

interface SelectDropdownProps {
  onValueChange?: (value: string) => void
  defaultValue: string | undefined
  placeholder?: string
  isPending?: boolean
  items: { label: string; value: string }[] | undefined
  disabled?: boolean
  className?: string
  isControlled?: boolean
}

export default function SelectDropdown({
  defaultValue,
  onValueChange,
  isPending,
  items,
  placeholder,
  disabled,
  className = "",
  isControlled = false,
}: SelectDropdownProps) {
  const defaultState = isControlled
    ? { value: defaultValue, onValueChange }
    : { defaultValue, onValueChange }
  return (
    <Select {...defaultState}>
      <FormControl>
        <SelectTrigger disabled={disabled} className={cn(className)}>
          <SelectValue placeholder={placeholder ?? "Select"} />
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        {isPending ? (
          <SelectItem disabled value="loading" className="h-14">
            <div className="flex items-center justify-center gap-2">
              <Icon icon="tabler:loader" />
              {"  "}
              Loading...
            </div>
          </SelectItem>
        ) : (
          items?.map(({ label, value }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )
}
