"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { Icon } from "@iconify/react"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import { Input } from "@repo/ui/components/input"
import { cn } from "@repo/ui/lib/utils"
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import {
  addCompetitorAction,
  removeCompetitorsAction,
  updateCompetitorAction,
} from "@/app/(app)/dashboard/actions"
import { MAX_COMPETITORS } from "@/lib/constants"
import type { SiteRow } from "@/lib/db-types"
import { type AddCompetitorInput, AddCompetitorSchema } from "@/lib/schemas"

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

type EditingState = { id: string; value: string } | null

export function CompetitorDrawerView({ competitors }: { competitors: SiteRow[] }) {
  const [pending, start] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<EditingState>(null)
  const urlInputId = useId()
  const selectAllId = useId()

  const atLimit = competitors.length >= MAX_COMPETITORS
  const competitorIds = useMemo(() => competitors.map((c) => c.id), [competitors])

  // Drop selections that no longer exist after removal.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>()
      for (const id of prev) if (competitorIds.includes(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [competitorIds])

  const allSelected = competitors.length > 0 && selected.size === competitors.length
  const someSelected = selected.size > 0 && !allSelected

  const form = useForm<AddCompetitorInput>({
    resolver: zodResolver(AddCompetitorSchema),
  })

  const onAdd = form.handleSubmit((data) => {
    start(async () => {
      const result = await addCompetitorAction(data)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Competitor added")
      form.reset()
    })
  })

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAll = () =>
    setSelected((prev) => (prev.size === competitors.length ? new Set() : new Set(competitorIds)))

  const onBulkRemove = () => {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    start(async () => {
      const result = await removeCompetitorsAction({ siteIds: ids })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.removed === 1 ? "1 competitor removed" : `${result.removed} competitors removed`
      )
      setSelected(new Set())
    })
  }

  const onEditCommit = () => {
    if (!editing) return
    const target = editing
    start(async () => {
      const result = await updateCompetitorAction({
        siteId: target.id,
        label: target.value.trim() ? target.value.trim() : null,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Label updated")
      setEditing(null)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Add row — disabled-look notice when at limit */}
      <div className="border-b border-border-subtle px-5 py-4">
        {atLimit ? (
          <p className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <Icon icon="lucide:info" className="size-4 shrink-0 text-ink-tertiary" />
            <span>
              Limit of <span className="num tabular-nums">{MAX_COMPETITORS}</span> reached. Remove
              one below to add another.
            </span>
          </p>
        ) : (
          <form onSubmit={onAdd} className="flex flex-col gap-2.5">
            <label
              htmlFor={urlInputId}
              className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary"
            >
              Add competitor
            </label>
            <div className="flex items-stretch gap-2">
              <Input
                id={urlInputId}
                type="url"
                placeholder="https://competitor.com"
                aria-invalid={!!form.formState.errors.url}
                className="h-9 flex-1 text-[14px]"
                {...form.register("url")}
              />
              <Input
                type="text"
                placeholder="Label (optional)"
                className="h-9 w-32 text-[14px]"
                {...form.register("label")}
              />
              <Button
                type="submit"
                disabled={pending}
                size="sm"
                className="h-9 shrink-0 gap-1.5 px-3"
              >
                <Icon icon="lucide:plus" className="size-3.5" />
                Add
              </Button>
            </div>
            {form.formState.errors.url ? (
              <p className="text-[12px] text-status-failure">{form.formState.errors.url.message}</p>
            ) : null}
          </form>
        )}
      </div>

      {/* List header — flips into a bulk action bar when items are selected */}
      {competitors.length > 0 ? (
        <div
          className={cn(
            "sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border-subtle bg-surface-base/95 px-5 py-2.5 backdrop-blur",
            selected.size > 0 && "bg-brand-accent-soft/40"
          )}
        >
          <div className="flex items-center gap-2.5 text-[13px] text-ink-secondary">
            <Checkbox
              id={selectAllId}
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={toggleAll}
              aria-label="Select all competitors"
            />
            <label htmlFor={selectAllId} className="cursor-pointer">
              {selected.size > 0 ? (
                <span className="num text-ink-primary tabular-nums">{selected.size} selected</span>
              ) : (
                <span>Select all</span>
              )}
            </label>
          </div>
          {selected.size > 0 ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onBulkRemove}
                disabled={pending}
                className="h-8 gap-1.5 px-2.5 text-[13px] text-status-failure hover:bg-status-failure-soft hover:text-status-failure"
              >
                <Icon icon="lucide:trash-2" className="size-3.5" />
                Remove
              </Button>
            </div>
          ) : (
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-tertiary">
              {competitors.length} total
            </span>
          )}
        </div>
      ) : null}

      {/* List body — scrollable */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {competitors.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <Icon icon="lucide:users" className="size-6 text-ink-tertiary" />
            <p className="text-[14px] text-ink-secondary">No competitors yet.</p>
            <p className="text-[13px] text-ink-tertiary">
              Add a URL above to start comparing scores.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {competitors.map((c) => {
              const isSelected = selected.has(c.id)
              const isEditing = editing?.id === c.id
              const host = hostname(c.url)
              const labelDisplay = c.label?.trim() || host
              return (
                <li
                  key={c.id}
                  className={cn(
                    "group flex items-start gap-3 px-5 py-3 transition-colors duration-75",
                    isSelected ? "bg-brand-accent-soft/30" : "hover:bg-surface-sunken/60"
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleOne(c.id)}
                    aria-label={`Select ${labelDisplay}`}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <CompetitorEditRow
                        initialValue={editing.value}
                        onChange={(value) => setEditing({ id: c.id, value })}
                        onCommit={onEditCommit}
                        onCancel={() => setEditing(null)}
                        pending={pending}
                      />
                    ) : (
                      <>
                        <div className="truncate text-[14px] font-medium text-ink-primary">
                          {labelDisplay}
                        </div>
                        <div className="num truncate text-[12px] text-ink-tertiary">{c.url}</div>
                      </>
                    )}
                  </div>
                  {!isEditing ? (
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-75 group-hover:opacity-100 group-focus-within:opacity-100">
                      <IconButton
                        label={`Edit label for ${labelDisplay}`}
                        icon="lucide:pencil"
                        onClick={() => setEditing({ id: c.id, value: c.label ?? "" })}
                        disabled={pending}
                      />
                      <IconButton
                        label={`Remove ${labelDisplay}`}
                        icon="lucide:trash-2"
                        onClick={() =>
                          start(async () => {
                            const result = await removeCompetitorsAction({ siteIds: [c.id] })
                            if (!result.ok) {
                              toast.error(result.error)
                              return
                            }
                            toast.success("Competitor removed")
                          })
                        }
                        disabled={pending}
                        tone="failure"
                      />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function CompetitorEditRow({
  initialValue,
  onChange,
  onCommit,
  onCancel,
  pending,
}: {
  initialValue: string
  onChange: (next: string) => void
  onCommit: () => void
  onCancel: () => void
  pending: boolean
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <div className="flex items-center gap-1.5">
      <Input
        ref={ref}
        defaultValue={initialValue}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            onCommit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            onCancel()
          }
        }}
        placeholder="Label (e.g. Big Co.)"
        className="h-8 flex-1 text-[14px]"
        disabled={pending}
      />
      <IconButton
        label="Save label"
        icon="lucide:check"
        onClick={onCommit}
        disabled={pending}
        tone="success"
      />
      <IconButton label="Cancel" icon="lucide:x" onClick={onCancel} disabled={pending} />
    </div>
  )
}

function IconButton({
  label,
  icon,
  onClick,
  disabled,
  tone = "neutral",
}: {
  label: string
  icon: string
  onClick: () => void
  disabled?: boolean
  tone?: "neutral" | "failure" | "success"
}) {
  const toneClass =
    tone === "failure"
      ? "text-ink-tertiary hover:text-status-failure hover:bg-status-failure-soft"
      : tone === "success"
        ? "text-ink-tertiary hover:text-status-success hover:bg-status-success-soft"
        : "text-ink-tertiary hover:text-ink-primary hover:bg-surface-sunken"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded transition-colors duration-75 disabled:opacity-50 disabled:cursor-not-allowed",
        toneClass
      )}
    >
      <Icon icon={icon} className="size-3.5" />
    </button>
  )
}
