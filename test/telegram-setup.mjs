/**
 * One-shot Telegram setup for dsh-turn-notify.
 *
 * Takes a bot token, asks Telegram who the bot is, then waits for the first
 * message anyone sends to that bot. The chat id from that message is written
 * into turn-notify.json and a confirmation is delivered through the plugin's
 * own channel code — so a successful run proves the whole path, not just the
 * credential format.
 *
 * Usage:
 *   node test/telegram-setup.mjs <botToken> [--timeout <seconds>]
 *
 * Get a token from @BotFather: /newbot, pick a name and a username.
 */

import { readFile, writeFile } from 'node:fs/promises'

import { CONFIG_PATH, notify } from '../lib/notify.js'

const token = (process.argv[2] ?? '').trim()
const timeoutArg = process.argv.indexOf('--timeout')
const timeoutSeconds = timeoutArg > 0 ? Number(process.argv[timeoutArg + 1]) : 180

if (token === '' || !/^\d+:[\w-]+$/.test(token)) {
  console.error('Uso: node test/telegram-setup.mjs <botToken> [--timeout 180]')
  console.error('El token lo da @BotFather con /newbot y tiene la forma 123456789:AAH...')
  process.exit(1)
}

const api = (method, query = '') => `https://api.telegram.org/bot${token}/${method}${query}`

/** Call one Bot API method and unwrap `result`. */
async function call(method, query = '') {
  const response = await fetch(api(method, query), { signal: AbortSignal.timeout(35_000) })
  const payload = await response.json().catch(() => ({ ok: false, description: 'respuesta no JSON' }))
  if (!payload.ok) throw new Error(payload.description ?? `HTTP ${response.status}`)
  return payload.result
}

console.log('1/3 Consultando el bot…')
let me
try {
  me = await call('getMe')
} catch (error) {
  console.error(`   Token rechazado por Telegram: ${error.message}`)
  process.exit(1)
}
console.log(`   Bot: @${me.username} (${me.first_name})`)

console.log(`2/3 Esperando un mensaje… abrí Telegram, buscá @${me.username} y mandale "hola"`)
console.log(`   Tenés ${timeoutSeconds}s.`)

const deadline = Date.now() + timeoutSeconds * 1000
let offset = 0
let chat
while (Date.now() < deadline && chat === undefined) {
  let updates = []
  try {
    updates = await call('getUpdates', `?timeout=25&offset=${offset}`)
  } catch (error) {
    console.error(`   getUpdates falló: ${error.message}`)
    process.exit(1)
  }
  for (const update of updates) {
    offset = update.update_id + 1
    const candidate = update.message?.chat ?? update.channel_post?.chat ?? update.edited_message?.chat
    if (candidate?.id !== undefined) {
      chat = candidate
      break
    }
  }
}

if (chat === undefined) {
  console.error('   Nadie le escribió al bot todavía. Volvé a correr el script y mandale el mensaje antes del timeout.')
  process.exit(1)
}

console.log(`   Chat detectado: ${chat.id} (${chat.username ? '@' + chat.username : chat.first_name ?? chat.type})`)

console.log('3/3 Guardando y mandando la prueba…')
let config = {}
try {
  config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
} catch {
  config = {}
}
config.telegram = { enabled: true, botToken: token, chatId: String(chat.id) }
await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8')

const delivered = await notify(config, {
  title: 'DSH Telegram',
  body: 'Listo: las notificaciones de DSH llegan a este chat.',
  priority: 3,
})

if (!delivered.includes('telegram')) {
  console.error('   La config quedó guardada pero el envío falló. Revisá el token en @BotFather.')
  process.exit(1)
}

console.log('   Telegram configurado y probado.')
console.log(`   Config: ${CONFIG_PATH}`)
