// Generate PWA / apple-touch icons from the brand mark.
// Run: node scripts/gen-icons.mjs
//
// The source is brand/beehive-logo.png - a 256px square extracted from the
// official beehive.ico (raster; there is no vector original). It sits on a
// solid white background, so every derived icon pads with white too: any
// other colour would frame the source's own white square. public/beehive.ico
// is the brand file copied verbatim and doubles as the favicon - the old
// hand-drawn favicon.svg approximation is gone.
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'brand', 'beehive-logo.png'))

async function gen(size, pad, out) {
  const inner = Math.round(size * (1 - pad * 2))
  const logo = await sharp(src)
    .resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer()
  const offset = Math.round((size - inner) / 2)
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: logo, left: offset, top: offset }])
    .png()
    .toFile(join(root, 'public', out))
  console.log('wrote', out, `${size}x${size}`)
}

// iOS home-screen icon (iOS ignores the manifest; needs this PNG, no transparency)
await gen(180, 0.04, 'apple-touch-icon.png')
// Manifest "any" icons. The source already carries its own margins, so the
// extra padding stays small.
await gen(192, 0.04, 'pwa-192.png')
await gen(512, 0.04, 'pwa-512.png')
// Maskable: extra padding so nothing is cropped inside the safe zone
await gen(512, 0.14, 'pwa-maskable-512.png')
