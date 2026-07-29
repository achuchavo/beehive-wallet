// Generates dist/build-manifest.json + dist/SHA256SUMS.txt so anyone can verify
// the files served at wallet.beehive.kr match a reproducible build of a specific
// commit. Run from the app/ directory, AFTER `vite build`.
//
// bundleHash is a single fingerprint for the whole bundle: the SHA-256 of the
// sorted "<sha256>  <path>" lines. It deliberately EXCLUDES this script's own
// outputs (build-manifest.json, SHA256SUMS.txt) so it stays stable across runs.
import { createHash } from 'node:crypto'
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { execSync } from 'node:child_process'

const DIST = 'dist'
const OUT_MANIFEST = join(DIST, 'build-manifest.json')
const OUT_SUMS = join(DIST, 'SHA256SUMS.txt')
const EXCLUDE = new Set(['build-manifest.json', 'SHA256SUMS.txt'])

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function commit() {
  if (process.env.VITE_COMMIT) return process.env.VITE_COMMIT
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execSync('git rev-parse HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

const files = walk(DIST)
  .map((p) => relative(DIST, p).split(sep).join('/'))
  .filter((rel) => !EXCLUDE.has(rel))
  .sort()

const fileHashes = {}
const sumLines = []
for (const rel of files) {
  const h = sha256(readFileSync(join(DIST, rel)))
  fileHashes[rel] = h
  sumLines.push(`${h}  ${rel}`)
}

const bundleHash = sha256(sumLines.join('\n') + '\n')

const manifest = {
  commit: commit(),
  tag: process.env.GITHUB_REF_NAME || '',
  algorithm: 'sha256',
  bundleHash,
  files: fileHashes,
}

writeFileSync(OUT_SUMS, sumLines.join('\n') + '\n')
writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + '\n')

console.log(`bundleHash sha256: ${bundleHash}`)
console.log(`commit:           ${manifest.commit}`)
console.log(`files hashed:     ${files.length}`)
