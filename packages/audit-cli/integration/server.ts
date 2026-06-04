import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"

const pagesDir = new URL("./pages/", import.meta.url)

export async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const path = req.url === "/" ? "/index.html" : (req.url ?? "/index.html")
    try {
      const body = await readFile(fileURLToPath(new URL(`.${path}`, pagesDir)))
      res.writeHead(200, { "content-type": "text/html" })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end("not found")
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  if (!addr || typeof addr === "string") throw new Error("server failed to bind")
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  }
}
