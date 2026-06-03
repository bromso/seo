"use client"

import { Icon } from "@iconify/react"
import { Button } from "@repo/ui/components/button"
import { Calendar } from "@repo/ui/components/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover"
import { cn } from "@repo/ui/lib/utils"
import { format } from "date-fns"
import * as React from "react"

export default function DatePicker() {
  const [date, setDate] = React.useState<Date>()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn("justify-start text-left font-normal", !date && "text-muted-foreground")}
        >
          <Icon icon="lucide:calendar" />
          {date ? format(date, "PPP") : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
      </PopoverContent>
    </Popover>
  )
}
