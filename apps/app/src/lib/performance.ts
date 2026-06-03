import type { Metric } from "web-vitals"

/**
 * Report Web Vitals metrics for performance monitoring
 * This function is called automatically by Next.js when using the App Router
 *
 * Core Web Vitals:
 * - CLS (Cumulative Layout Shift)
 * - FID (First Input Delay) / INP (Interaction to Next Paint)
 * - LCP (Largest Contentful Paint)
 *
 * Other metrics:
 * - FCP (First Contentful Paint)
 * - TTFB (Time to First Byte)
 */
export function reportWebVitals(metric: Metric) {
  // Log to console in development
  if (process.env.NODE_ENV === "development") {
    console.log(`[Web Vital] ${metric.name}:`, {
      value: metric.value,
      rating: metric.rating,
      delta: metric.delta,
      id: metric.id,
    })
  }

  // In production, you can send to your analytics service
  // Example: Send to Google Analytics
  // if (typeof window !== "undefined" && window.gtag) {
  //   window.gtag("event", metric.name, {
  //     event_category: "Web Vitals",
  //     event_label: metric.id,
  //     value: Math.round(metric.name === "CLS" ? metric.value * 1000 : metric.value),
  //     non_interaction: true,
  //   })
  // }

  // Example: Send to custom analytics endpoint
  // fetch("/api/analytics/web-vitals", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     name: metric.name,
  //     value: metric.value,
  //     rating: metric.rating,
  //     delta: metric.delta,
  //     id: metric.id,
  //     page: window.location.pathname,
  //   }),
  // })
}

/**
 * Performance thresholds based on Core Web Vitals
 */
export const PERFORMANCE_THRESHOLDS = {
  LCP: { good: 2500, needsImprovement: 4000 },
  FID: { good: 100, needsImprovement: 300 },
  CLS: { good: 0.1, needsImprovement: 0.25 },
  FCP: { good: 1800, needsImprovement: 3000 },
  TTFB: { good: 800, needsImprovement: 1800 },
  INP: { good: 200, needsImprovement: 500 },
} as const
