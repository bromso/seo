import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card"
import type { SiteRow } from "@/lib/db-types"

export function SiteSummaryCard({ site }: { site: SiteRow }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{site.label ?? site.url}</CardTitle>
      </CardHeader>
      <CardContent>
        <a
          href={site.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-muted-foreground underline"
        >
          {site.url}
        </a>
      </CardContent>
    </Card>
  )
}
