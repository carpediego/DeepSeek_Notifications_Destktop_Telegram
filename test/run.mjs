/**
 * Self-check for the wiring and the session label.
 *
 * A fake cordis context captures the listeners, then the test drives:
 *   - a session/title event, to prove the label comes from the conversation
 *   - running -> idle, an error and an approval (channels disabled)
 *   - a second session with no title, to prove the folder fallback
 * and finally reads the diagnostics log to assert what each body said.
 *
 * Run: node test/run.mjs
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'turn-notify-'))
const configPath = join(dir, 'turn-notify.json')
const logPath = join(dir, 'turn-notify.log')
await writeFile(
  configPath,
  JSON.stringify({ desktop: false, minTurnDurationMs: 0, telegram: { enabled: false } }),
)
process.env.DSH_TURN_NOTIFY_CONFIG = configPath
process.env.DSH_TURN_NOTIFY_LOG = logPath

const module = await import('../lib/index.js')

const handlers = new Map()
const warnings = []
const ctx = {
  on(event, handler) {
    if (!handlers.has(event)) handlers.set(event, [])
    handlers.get(event).push(handler)
    return () => {}
  },
  logger: { warn: (message) => warnings.push(message) },
}

module.apply(ctx)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fire = (event, ...args) => {
  for (const handler of handlers.get(event) ?? []) handler(...args)
}

let failed = false
const fail = (message) => {
  console.error('FAIL:', message)
  failed = true
}

for (const event of ['agent/status', 'agent/error', 'approval/request', 'session/event']) {
  if (!handlers.has(event)) fail(`${event} listener missing`)
}

// Session with an announced title.
const titled = {
  id: 'agent-titled',
  session: {
    header: { id: 'session-abcdef', cwd: 'C:\\proyectos\\tienda-online' },
  },
}
fire('session/event', titled.session, { type: 'session/title', data: { title: 'Arreglar el carrito de compras' } })
fire('agent/status', { agent: titled, status: 'running' })
await sleep(20)
fire('agent/status', { agent: titled, status: 'idle' })

// Session with no title: the folder name has to carry the label.
const untitled = {
  id: 'agent-untitled',
  session: { header: { id: 'session-123456', cwd: 'C:\\proyectos\\facturacion' } },
}
fire('agent/status', { agent: untitled, status: 'running' })
await sleep(20)
fire('agent/status', { agent: untitled, status: 'idle' })

// Error and approval use the same label path.
fire('agent/error', { agent: titled, error: new Error('boom') })

let delegated = 0
const next = () => {
  delegated += 1
}
fire('approval/request', { agent: titled }, next)
fire('approval/request', { agent: titled }, next)

await sleep(600)

const log = await readFile(logPath, 'utf8')

if (log.includes('Sesión abcdef') || log.includes('Sesión 123456')) {
  fail('the short session id leaked into a notification body')
}
if (!log.includes('Arreglar el carrito de compras')) fail('announced title missing from the body')
if (!log.includes('facturacion')) fail('folder fallback missing from the body')
if (delegated !== 2) fail(`approval must always delegate, got ${delegated}`)
if (warnings.length > 0) fail(`unexpected warnings: ${warnings.join(' | ')}`)

if (!failed) console.log('ok: listeners wired, title and folder labels resolved, approval delegates')
process.exitCode = failed ? 1 : 0
