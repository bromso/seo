import { type CheerioAPI, load } from "cheerio"
import type { FetchedPage } from "./types.js"

export function parse(page: FetchedPage): CheerioAPI {
  return load(page.html, { xmlMode: false })
}
