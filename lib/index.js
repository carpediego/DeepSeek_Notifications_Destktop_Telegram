/**
 * dsh-turn-notify — host-only notification plugin for DeepSeek Harness 0.2.x.
 *
 * Why this exists: community notification plugins declare a 0.1.7 peer range,
 * and DSH refuses to install those on 0.2.x. This plugin talks only to the
 * stable seams that are still present in 0.2.1:
 *
 *   agent/status        -> running/idle edge, i.e. a turn started and finished
 *   agent/error         -> the turn failed
 *   approval/request    -> a tool call is waiting for the user (waterfall)
 *
 * It registers no client bundle, no UI slot and no model-facing tool, so the
 * worst case is a logged load error rather than a broken window.
 *
 * Config is read from $DSH_HOME/turn-notify.json on every event, so edits apply
 * without a restart. See turn-notify.example.json for the full shape.
 */

import { appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { notify, loadConfig, setReporter } from './notify.js'

export const name = 'dsh-turn-notify'

/** No host service is required; the event seams alone are enough. */
export const inject = []

/**
 * Diagnostic trail. The plugin has no UI, so this file is the only way to tell
 * "the host never loaded me" apart from "loaded but something failed later":
 * no line at all means the module was never applied.
 */
const LOG_PATH =
  process.env.DSH_TURN_NOTIFY_LOG ||
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'turn-notify.log')

/** Append one timestamped line; a logging failure never breaks a turn. */
function log(line) {
  const stamp = new Date().toISOString()
  void appendFile(LOG_PATH, `${stamp} ${line}\n`, 'utf8').catch(() => {})
}

// Written while the module is evaluated, before cordis ever calls apply(). It
// separates "the loader never imported this file" from "imported but apply()
// was not invoked", which are different bugs with different fixes.
log(`module-evaluated pid=${process.pid}`)

/** Minimum gap between two approval pings for the same session. */
const APPROVAL_THROTTLE_MS = 5000

/**
 * Describe the session behind an agent.
 * @returns a short human label, never empty.
 */
function sessionLabel(agent) {
  const title = agent?.session?.header?.title
  if (typeof title === 'string' && title.trim() !== '') return title.trim().slice(0, 80)
  const id = agent?.session?.header?.id ?? agent?.id
  return typeof id === 'string' ? `Sesión ${id.slice(-6)}` : 'Sesión DSH'
}

/** Format a duration the way a status line reads. */
function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** One error payload rendered small enough for a notification body. */
function errorText(error) {
  const message = error instanceof Error ? error.message : String(error ?? 'error desconocido')
  return message.replace(/\s+/g, ' ').slice(0, 200)
}

/**
 * Register the listeners.
 * @param ctx - the cordis plugin context.
 */
export function apply(ctx) {
  /** agent -> wall-clock start of the current running interval */
  const turnStarted = new Map()
  /** session key -> time of the last approval ping */
  const lastApproval = new Map()

  log(`apply pid=${process.pid} platform=${process.platform} log=${LOG_PATH}`)
  setReporter(log)

  const send = (payload) => {
    void loadConfig()
      .then((config) => notify(config, payload))
      .then((delivered) => {
        log(`sent "${payload.title}" -> ${delivered.length === 0 ? 'no channel' : delivered.join('+')}`)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        log(`send failed: ${message}`)
        ctx.logger?.warn?.(`turn-notify: ${message}`)
      })
  }

  ctx.on('agent/status', ({ agent, status }) => {
    try {
      const label = sessionLabel(agent)
      if (status === 'running') {
        turnStarted.set(agent, Date.now())
        log(`running: ${label}`)
        return
      }
      if (status !== 'idle') {
        log(`status ${status}: ${label}`)
        return
      }
      const started = turnStarted.get(agent)
      turnStarted.delete(agent)
      if (started === undefined) {
        log(`idle without a recorded start: ${label}`)
        return
      }
      const elapsed = Date.now() - started
      void loadConfig().then((config) => {
        const floor = Number(config.minTurnDurationMs ?? 5000)
        if (Number.isFinite(floor) && elapsed < floor) {
          log(`idle after ${elapsed}ms, below floor ${floor}ms: ${label}`)
          return
        }
        send({
          title: 'DSH terminó',
          body: `${label} · ${formatDuration(elapsed)}`,
        })
      })
    } catch (error) {
      log(`agent/status handler failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  ctx.on('agent/error', ({ agent, error }) => {
    try {
      log(`agent/error: ${sessionLabel(agent)}`)
      void loadConfig().then((config) => {
        if (config.notifyOnError === false) return
        send({
          title: 'DSH error',
          body: `${sessionLabel(agent)} · ${errorText(error)}`,
        })
      })
    } catch (failure) {
      log(`agent/error handler failed: ${failure instanceof Error ? failure.message : String(failure)}`)
    }
  })

  // approval/request is a waterfall: notify, then always delegate so the real
  // answerer still receives the request.
  ctx.on('approval/request', (request, next) => {
    try {
      void loadConfig().then((config) => {
        if (config.notifyOnApproval === false) return
        const key = request?.agent?.session?.header?.id ?? request?.agent?.id ?? 'unknown'
        const now = Date.now()
        if (now - (lastApproval.get(key) ?? 0) < APPROVAL_THROTTLE_MS) return
        lastApproval.set(key, now)
        log('approval requested')
        send({
          title: 'DSH necesita tu aprobación',
          body: sessionLabel(request?.agent),
        })
      })
    } catch (failure) {
      log(`approval handler failed: ${failure instanceof Error ? failure.message : String(failure)}`)
    }
    return next()
  })
}

export default { name, inject, apply }
