import type { LighthouseAudit, LighthouseCategory, RawLighthouseResult } from "./types.js"

type RawLhr = {
  requestedUrl: string
  finalUrl: string
  fetchTime: string
  lighthouseVersion: string
  categories: Record<string, LighthouseCategory>
  audits: Record<string, LighthouseAudit>
  runtimeError?: { code: string; message: string }
}

export function project(lhr: RawLhr): RawLighthouseResult {
  const cat = lhr.categories
  const performance = cat.performance
  const seo = cat.seo
  const bestPractices = cat["best-practices"]
  if (!performance || !seo || !bestPractices) {
    throw new Error("lighthouse result missing required category (performance/seo/best-practices)")
  }
  const out: RawLighthouseResult = {
    requestedUrl: lhr.requestedUrl,
    finalUrl: lhr.finalUrl,
    fetchTime: lhr.fetchTime,
    lighthouseVersion: lhr.lighthouseVersion,
    categories: {
      performance,
      seo,
      "best-practices": bestPractices,
      ...(cat.pwa !== undefined ? { pwa: cat.pwa } : {}),
    },
    audits: lhr.audits,
  }
  if (lhr.runtimeError !== undefined) out.runtimeError = lhr.runtimeError
  return out
}
