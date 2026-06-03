import { copyFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import sharp from "sharp"

const sizes = [
  { name: "icon-192x192.png", size: 192 },
  { name: "icon-512x512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
]

async function generateIconsForApp(appDir: string) {
  const inputSvg = join(appDir, "public/logo.svg")
  const outputDir = join(appDir, "public/icons")

  await mkdir(outputDir, { recursive: true })

  for (const { name, size } of sizes) {
    await sharp(inputSvg)
      .resize(size, size, { fit: "contain", background: { r: 10, g: 10, b: 10, alpha: 1 } })
      .png()
      .toFile(join(outputDir, name))
    console.log(`Generated ${name} (${size}x${size})`)
  }

  // Maskable icon with 20% safe zone padding
  const maskableSize = 512
  const padding = Math.floor(maskableSize * 0.2)
  const innerSize = maskableSize - padding * 2

  await sharp(inputSvg)
    .resize(innerSize, innerSize, { fit: "contain", background: { r: 10, g: 10, b: 10, alpha: 0 } })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 10, g: 10, b: 10, alpha: 1 }, // #0A0A0A brand color
    })
    .png()
    .toFile(join(outputDir, "icon-maskable-512x512.png"))
  console.log("Generated icon-maskable-512x512.png")
}

async function setupWwwIcons() {
  // apps/www already has icons in public/favicon, create symlinks or copy to icons folder
  const wwwDir = "apps/www"
  const outputDir = join(wwwDir, "public/icons")
  const faviconDir = join(wwwDir, "public/favicon")

  await mkdir(outputDir, { recursive: true })

  // Copy existing icons to the icons folder
  await copyFile(
    join(faviconDir, "web-app-manifest-192x192.png"),
    join(outputDir, "icon-192x192.png")
  )
  await copyFile(
    join(faviconDir, "web-app-manifest-512x512.png"),
    join(outputDir, "icon-512x512.png")
  )
  await copyFile(join(faviconDir, "apple-touch-icon.png"), join(outputDir, "apple-touch-icon.png"))

  // Generate maskable icon from favicon.svg
  await sharp(join(faviconDir, "favicon.svg"))
    .resize(307, 307, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .extend({
      top: 102,
      bottom: 103,
      left: 102,
      right: 103,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toFile(join(outputDir, "icon-maskable-512x512.png"))

  console.log("Set up icons for apps/www")
}

console.log("Generating PWA icons...")
console.log("\n=== apps/app ===")
await generateIconsForApp("apps/app")
console.log("\n=== apps/www ===")
await setupWwwIcons()
console.log("\nDone!")
