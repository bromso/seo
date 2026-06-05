"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { addCompetitorAction, removeCompetitorAction } from "@/app/(app)/dashboard/actions"
import { MAX_COMPETITORS } from "@/lib/constants"
import type { SiteRow } from "@/lib/db-types"
import { type AddCompetitorInput, AddCompetitorSchema } from "@/lib/schemas"

export function CompetitorDrawerView({ competitors }: { competitors: SiteRow[] }) {
  const atLimit = competitors.length >= MAX_COMPETITORS
  const form = useForm<AddCompetitorInput>({
    resolver: zodResolver(AddCompetitorSchema),
  })
  const [pending, start] = useTransition()

  const onSubmit = form.handleSubmit((data) => {
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

  return (
    <div className="space-y-6 py-4">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">
          Competitors ({competitors.length}/{MAX_COMPETITORS})
        </h3>
        {competitors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No competitors yet.</p>
        ) : (
          <ul className="space-y-2">
            {competitors.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.label ?? c.url}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.url}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    start(async () => {
                      const result = await removeCompetitorAction(c.id)
                      if (!result.ok) toast.error(result.error)
                      else toast.success("Competitor removed")
                    })
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {atLimit ? (
        <p className="text-sm text-muted-foreground">
          Limit reached ({MAX_COMPETITORS} of {MAX_COMPETITORS}).
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="competitor-url">Competitor URL</Label>
            <Input
              id="competitor-url"
              type="url"
              placeholder="https://competitor.com"
              {...form.register("url")}
            />
            {form.formState.errors.url ? (
              <p className="text-sm text-destructive">{form.formState.errors.url.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="competitor-label">Label (optional)</Label>
            <Input
              id="competitor-label"
              type="text"
              placeholder="Competitor A"
              {...form.register("label")}
            />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Adding…" : "Add competitor"}
          </Button>
        </form>
      )}
    </div>
  )
}
