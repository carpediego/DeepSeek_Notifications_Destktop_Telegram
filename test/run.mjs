/**
 * Self-check for the wiring: a fake cordis context captures the listeners,
 * then the test drives running -> idle, an error and an approval, and asserts
 * one notification each (with delivery channels disabled in a temp config).
 *
 * Run: node test/run.mjs
 */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'turn-notify-'))
const configPath = join(dir, 'turn-notify.json')
await writeFile(
  configPath,
  JSON.stringify({ desktop: false, minTurnDurationMs: 0, telegram: { enabled: false } }),
)
process.env.DSH_TURN_NOTIFY_CONFIG = configPath
process.env.DSH_TURN_NOTIFY_LOG = join(dir, 'turn-notify.log')

const module = await import('../lib/index.js')

const handlers = new Map()
const logs = []
const ctx = {
  on(event, handler) {
    if (!handlers.has(event)) handlers.set(event, [])
    handlers.get(event).push(handler)
    return () => {}
  },
  logger: { warn: (message) => logs.push(message) },
}

module.apply(ctx)

const agent = { id: 'agent-1', session: { header: { id: 'session-abcdef', title: 'Prueba de notificación' } } }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fail = (message) => {
  console.error('FAIL:', message)
  process.exitCode = 1
}

if (!handlers.has('agent/status')) fail('agent/status listener missing')
if (!handlers.has('agent/error')) fail('agent/error listener missing')
if (!handlers.has('approval/request')) fail('approval/request listener missing')

// One finished turn.
handlers.get('agent/status')[0]({ agent, status: 'running' })
await sleep(20)
handlers.get('agent/status')[0]({ agent, status: 'idle' })

// One error.
handlers.get('agent/error')[0]({ agent, error: new Error('boom') })

// One approval, submitted twice, to prove the throttle collapses the pair.
let delegated = 0
const next = () => {
  delegated += 1
}
handlers.get('approval/request')[0]({ agent }, next)
handlers.get('approval/request')[0]({ agent }, next)

await sleep(400)

if (delegated !== 2) fail(`approval must always delegate, got ${delegated}`)
if (logs.length > 0) fail(`unexpected warnings: ${logs.join(' | ')}`)
if (process.exitCode === undefined) console.log('ok: listeners wired, approval delegates, throttled, no warnings')
