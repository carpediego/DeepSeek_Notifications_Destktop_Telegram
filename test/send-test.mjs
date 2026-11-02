/**
 * Send one real notification with the current config, to prove the channels
 * work from this machine.
 *
 * Run: node test/send-test.mjs
 */

import { loadConfig, notify } from '../lib/notify.js'

const config = await loadConfig()
const delivered = await notify(config, {
  title: 'DSH prueba',
  body: 'Notificaciones configuradas correctamente.',
})

const safe = {
  telegram: { enabled: config.telegram?.enabled ?? false, chatId: config.telegram?.chatId ?? '' },
  desktop: config.desktop !== false,
}
console.log('config:', JSON.stringify(safe))
console.log('delivered:', JSON.stringify(delivered))
if (delivered.length === 0) {
  console.error('Ningun canal reporto entrega. Revisa turn-notify.json.')
  process.exitCode = 1
}
