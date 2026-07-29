// A quiet footer line tying the running app to a public commit, so anyone can
// check the served code against the open source (see docs/VERIFYING-THE-BUILD.md).
// __BUILD_COMMIT__ is injected at build time by vite.config.ts.
const REPO = 'https://github.com/achuchavo/beehive-wallet'

export default function BuildBadge() {
  const commit = __BUILD_COMMIT__
  const isReal = commit !== 'dev' && commit.length >= 7
  const short = isReal ? commit.slice(0, 7) : 'dev'
  const commitUrl = isReal ? `${REPO}/commit/${commit}` : REPO

  return (
    <div className="px-3 pt-3 text-[11px] leading-tight text-slate-400">
      <a
        href={commitUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-amber-700"
        title="This build's source commit on GitHub"
      >
        Build {short}
      </a>
      {' · '}
      <a
        href={`${REPO}/blob/master/docs/VERIFYING-THE-BUILD.md`}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-amber-700"
        title="How to verify this build matches the public source"
      >
        Verify
      </a>
    </div>
  )
}
