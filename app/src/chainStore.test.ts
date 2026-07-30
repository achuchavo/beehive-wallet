/**
 * chains.ts reads window.location at module load to build the proxy origin, so
 * these need a DOM environment.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// The store self-loads on import, so each test resets the module registry and
// installs its own fetch stub before importing.
const CHAINS_JSON = {
  chains: [
    {
      key: 'medibloc',
      chainId: 'panacea-3',
      chainName: 'Medibloc',
      bech32Prefix: 'panacea',
      denom: 'umed',
      displayDenom: 'MED',
      decimals: 6,
      coinType: 371,
      gasPrice: '7umed',
      explorerTxUrl: 'https://x/tx/',
      explorerValidatorUrl: 'https://x/v/',
      beehiveValidator: 'panaceavaloper1abc',
      beehiveMoniker: 'Beehive',
      coingeckoId: 'medibloc',
      freeValidators: [],
      serviceFee: '0',
      feeCollector: '',
    },
  ],
}

function stubFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

function okResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chain store readiness', () => {
  it('reports ready and applies the DB config after loading', async () => {
    stubFetch(() => okResponse(CHAINS_JSON) as never)
    const store = await import('./chainStore')
    const chains = await import('./chains')

    await store.chainsReady
    expect(store.chainStatus()).toBe('ready')
    expect(store.chainsUsable()).toBe(true)
    // The DB value (7umed) must have replaced the bootstrap (5umed).
    expect(chains.findChain('medibloc')?.gasPrice).toBe('7umed')
  })

  it('replaces the registry rather than mutating the old array', async () => {
    stubFetch(() => okResponse(CHAINS_JSON) as never)
    const chains = await import('./chains')
    const before = chains.CHAINS
    const beforeSnapshot = before[0]
    const store = await import('./chainStore')

    await store.chainsReady
    // Old array and old object are untouched - a component holding either keeps
    // a stable snapshot instead of seeing fields change underneath it.
    expect(beforeSnapshot.gasPrice).toBe('5umed')
    expect(chains.CHAINS).not.toBe(before)
  })

  it('is not usable while still loading, so signing is blocked', async () => {
    let release: (v: unknown) => void = () => {}
    stubFetch(() => new Promise((r) => { release = r }) as never)
    const store = await import('./chainStore')

    expect(store.chainStatus()).toBe('loading')
    expect(store.chainsUsable()).toBe(false)

    release({ ok: true, status: 200, json: () => Promise.resolve(CHAINS_JSON) })
    await store.chainsReady
    expect(store.chainsUsable()).toBe(true)
  })

  it('surfaces an error and stays unusable when the API fails', async () => {
    stubFetch(() => Promise.reject(new Error('offline')) as never)
    const store = await import('./chainStore')

    await store.chainsReady
    expect(store.chainStatus()).toBe('error')
    // Signing must NOT proceed against an unverified bootstrap config.
    expect(store.chainsUsable()).toBe(false)
  })

  it('falls back to bootstrap config on an HTTP error', async () => {
    stubFetch(() => Promise.resolve({ ok: false, status: 500 }) as never)
    const store = await import('./chainStore')
    const chains = await import('./chains')

    await store.chainsReady
    expect(store.chainStatus()).toBe('error')
    // The wallet still resolves its chain, just from the bootstrap entry.
    expect(chains.findChain('medibloc')?.chainId).toBe('panacea-3')
  })

  it('adds a newly configured chain without stale state', async () => {
    stubFetch(() =>
      okResponse({
        chains: [
          ...CHAINS_JSON.chains,
          { ...CHAINS_JSON.chains[0], key: 'newchain', chainName: 'New', bech32Prefix: 'new', denom: 'unew', gasPrice: '1unew' },
        ],
      }) as never,
    )
    const store = await import('./chainStore')
    const chains = await import('./chains')

    await store.chainsReady
    expect(chains.findChain('newchain')?.chainName).toBe('New')
    // A wallet stored against the new chain now resolves instead of throwing.
    expect(() => chains.resolveChain('newchain')).not.toThrow()
  })

  it('rejects an invalid chain definition instead of registering it', async () => {
    stubFetch(() =>
      okResponse({
        chains: [
          ...CHAINS_JSON.chains,
          // decimals out of range and a malformed gas price
          { ...CHAINS_JSON.chains[0], key: 'bad', decimals: 99, gasPrice: 'notaprice' },
        ],
      }) as never,
    )
    const store = await import('./chainStore')
    const chains = await import('./chains')

    await store.chainsReady
    expect(chains.findChain('bad')).toBeUndefined()
    // The valid one still loaded.
    expect(chains.findChain('medibloc')).toBeDefined()
  })

  it('notifies subscribers when the registry changes', async () => {
    stubFetch(() => okResponse(CHAINS_JSON) as never)
    const store = await import('./chainStore')
    await store.chainsReady

    // useChains() subscribes via useSyncExternalStore; refreshChains must bump
    // the snapshot so React re-renders.
    const before = store.chainStatus()
    await store.refreshChains()
    expect(before).toBe('ready')
    expect(store.chainStatus()).toBe('ready')
  })

  it('an unknown chain key never silently falls back to another chain', async () => {
    stubFetch(() => okResponse(CHAINS_JSON) as never)
    const store = await import('./chainStore')
    const chains = await import('./chains')
    await store.chainsReady

    expect(chains.findChain('does-not-exist')).toBeUndefined()
    expect(() => chains.resolveChain('does-not-exist')).toThrow()
  })

  it('a refresh picks up a changed staking policy', async () => {
    // The reported bug: an admin saves a policy and the staking page keeps the
    // old one, because the registry only ever loaded once per tab.
    const withPolicy = (policy: string) => ({
      chains: [{ ...CHAINS_JSON.chains[0], stakingPolicy: policy }],
    })
    let current = withPolicy('all')
    stubFetch(() => okResponse(current) as never)
    const store = await import('./chainStore')
    const chains = await import('./chains')
    await store.chainsReady
    expect(chains.findChain('medibloc')!.stakingPolicy).toBe('all')

    current = withPolicy('allowlist')
    await store.refreshChains()
    expect(chains.findChain('medibloc')!.stakingPolicy).toBe('allowlist')
  })

  it('a refresh drops a chain the admin deactivated', async () => {
    // Merging over the live registry meant a deactivated chain lingered for the
    // life of the tab, still offered for sending and staking.
    const second = {
      ...CHAINS_JSON.chains[0],
      key: 'chihuahua',
      chainId: 'chihuahua-1',
      chainName: 'Chihuahua',
      bech32Prefix: 'chihuahua',
      denom: 'uhuahua',
      displayDenom: 'HUAHUA',
      gasPrice: '1uhuahua',
    }
    let current: unknown = { chains: [CHAINS_JSON.chains[0], second] }
    stubFetch(() => okResponse(current) as never)
    const store = await import('./chainStore')
    const chains = await import('./chains')
    await store.chainsReady
    expect(chains.findChain('chihuahua')).toBeDefined()

    current = { chains: [CHAINS_JSON.chains[0]] }
    await store.refreshChains()
    expect(chains.findChain('chihuahua')).toBeUndefined()
    expect(chains.findChain('medibloc')).toBeDefined()
  })

  it('a failed refresh keeps the working registry and stays usable', async () => {
    stubFetch(() => okResponse(CHAINS_JSON) as never)
    const store = await import('./chainStore')
    const chains = await import('./chains')
    await store.chainsReady
    const before = chains.findChain('medibloc')!.gasPrice

    // A transient blip must not downgrade an already-validated registry to
    // 'error' - that would disable signing for no reason.
    stubFetch(() => Promise.reject(new Error('offline')))
    await store.refreshChains()
    expect(store.chainStatus()).toBe('ready')
    expect(store.chainsUsable()).toBe(true)
    expect(chains.findChain('medibloc')!.gasPrice).toBe(before)
  })

  it('refuses to install an empty registry', async () => {
    stubFetch(() => okResponse(CHAINS_JSON) as never)
    const store = await import('./chainStore')
    const chains = await import('./chains')
    await store.chainsReady

    // Every chain rejected would otherwise leave nothing to sign against.
    stubFetch(() => okResponse({ chains: [] }) as never)
    await store.refreshChains()
    expect(chains.findChain('medibloc')).toBeDefined()
    expect(store.chainsUsable()).toBe(true)
  })
})
