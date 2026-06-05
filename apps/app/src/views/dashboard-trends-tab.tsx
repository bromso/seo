"use client"
import { CategoryTrendChart } from "@/components/category-trend-chart"
import { CATEGORIES } from "@/lib/constants"
import type { ScoreTrendRow } from "@/lib/db-types"

export function DashboardTrendsTab({ trends }: { trends: ScoreTrendRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {CATEGORIES.map((c) => (
        <CategoryTrendChart key={c} category={c} rows={trends} />
      ))}
    </div>
  )
}
