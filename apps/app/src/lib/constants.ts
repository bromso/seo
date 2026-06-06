export const MAX_COMPETITORS = 5
export const TRENDS_WINDOW_DAYS = 30
export const QUEUE_TTL_DAYS = 7
export const CATEGORIES = ["performance", "seo", "best-practices", "pwa", "on-page"] as const
export type Category = (typeof CATEGORIES)[number]
