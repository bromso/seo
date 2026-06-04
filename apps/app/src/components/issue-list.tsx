import { Badge } from "@repo/ui/components/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card"

type Issue = {
  rule: string
  severity: "info" | "warn" | "error"
  title: string
  description: string
  recommendation: string
  count: number
}

export function IssueList({ category, issues }: { category: string; issues: unknown[] }) {
  const typed = issues as Issue[]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base capitalize">
          Issues for {category} ({typed.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {typed.map((issue) => (
          <div key={issue.rule} className="space-y-1">
            <div className="flex items-center gap-2">
              <code className="text-sm">{issue.rule}</code>
              <Badge
                variant={
                  issue.severity === "error"
                    ? "destructive"
                    : issue.severity === "warn"
                      ? "outline"
                      : "secondary"
                }
              >
                {issue.severity}
              </Badge>
              {issue.count > 1 ? (
                <span className="text-xs text-muted-foreground">×{issue.count}</span>
              ) : null}
            </div>
            <p className="text-sm font-medium">{issue.title}</p>
            <p className="text-sm text-muted-foreground">{issue.description}</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Fix:</span> {issue.recommendation}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
