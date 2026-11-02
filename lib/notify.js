/**
 * Delivery channels for dsh-turn-notify.
 *
 * Two channels, both independent and best-effort:
 *   - telegram : Bot API sendMessage.
 *   - desktop  : Windows toast on the machine running DSH.
 *
 * A channel that fails never rejects and never throws into the agent loop:
 * every function resolves to `true` / `false`, and anything worth diagnosing
 * goes to the reporter (the plugin's log file).
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where the JSON config lives; override with DSH_TURN_NOTIFY_CONFIG. */
export const CONFIG_PATH =
  process.env.DSH_TURN_NOTIFY_CONFIG ||
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'turn-notify.json')

/** Where the spawned PowerShell reports what it actually managed to do. */
export const DESKTOP_LOG_PATH =
  process.env.DSH_TURN_NOTIFY_DESKTOP_LOG ||
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'turn-notify-desktop.log')

/** Hard ceiling for one provider call. A stuck provider never stalls a turn. */
const TIMEOUT_MS = 8000

/**
 * Optional diagnostic sink. A failed `spawn` surfaces only as an asynchronous
 * `error` event, so without this the desktop channel can look healthy while
 * producing nothing at all.
 */
let reporter = () => {}

/** Install the diagnostic sink (the plugin points it at its log file). */
export function setReporter(fn) {
  if (typeof fn === 'function') reporter = fn
}

/** Full path to Windows PowerShell 5.1, independent of PATH. */
function powershellPath() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const candidate = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(candidate) ? candidate : 'powershell.exe'
}

/**
 * Read the config file.
 * @returns the parsed object, or an empty object when the file is missing.
 */
export async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** POST a Telegram Bot API sendMessage call. */
async function sendTelegram(telegram, title, body) {
  const token = typeof telegram.botToken === 'string' ? telegram.botToken.trim() : ''
  const chatId = typeof telegram.chatId === 'string' ? telegram.chatId.trim() : String(telegram.chatId ?? '')
  if (token === '' || chatId === '') return false
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: `${title}\n${body}`, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return response.ok
}

/** Escape text for the toast XML body. */
function xmlEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * PowerShell that shows a real Windows toast, with the legacy balloon tip as a
 * fallback when the WinRT path is unavailable.
 *
 * Two things learned the hard way on Windows 11:
 *   - `NotifyIcon.ShowBalloonTip` alone is routinely swallowed by the shell.
 *   - A toast posted under an unregistered AUMID is accepted into the
 *     notification history but never drawn as a banner, which looks exactly
 *     like "nothing happened".
 *
 * `desktopSound` covers the remaining case where the platform silences the
 * toast sound (Do not disturb / banner toggle):
 *   "fallback" (default) | "always" | "off"
 */
export function buildDesktopScript(title, body, sound = 'fallback', aumid = 'com.deepseek.dsh', diagPath = '') {
  const heading = xmlEscape(title)
  const text = xmlEscape(body)
  const fallbackBeep = sound === 'off' ? '' : '[System.Media.SystemSounds]::Asterisk.Play()'
  const alwaysBeep = sound === 'always' ? '[System.Media.SystemSounds]::Asterisk.Play()' : ''
  const diag = diagPath.replace(/'/g, "''")
  return `
$ErrorActionPreference = 'Stop'
$diagPath = '${diag}'
function Write-Diag([string]$message) {
  if ($diagPath -eq '') { return }
  try { Add-Content -LiteralPath $diagPath -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString('o'), $message) } catch { }
}
Write-Diag "ps start pid=$PID"
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
  $xml = @"
<toast duration="short">
  <visual><binding template="ToastGeneric"><text>${heading}</text><text>${text}</text></binding></visual>
  <audio src="ms-winsoundevent:Notification.Default"/>
</toast>
"@
  $document = New-Object Windows.Data.Xml.Dom.XmlDocument
  $document.LoadXml($xml)
  $toast = New-Object Windows.UI.Notifications.ToastNotification $document
  # Prefer DSH's own registered AUMID so Windows shows the toast as the app the
  # user already knows, and lists it under that name in notification settings.
  $appIds = @(
    '${aumid}',
    '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
  )
  $shown = $false
  foreach ($appId in $appIds) {
    try {
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
      $shown = $true
      Write-Diag "toast shown appId=$appId"
      break
    } catch {
      Write-Diag ("toast rejected appId=" + $appId + " : " + $_.Exception.Message)
    }
  }
  if (-not $shown) { throw 'no toast notifier available' }
  ${alwaysBeep}
} catch {
  Write-Diag ("toast path failed: " + $_.Exception.Message)
  ${fallbackBeep}
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $icon = New-Object System.Windows.Forms.NotifyIcon
    $icon.Icon = [System.Drawing.SystemIcons]::Information
    $icon.Visible = $true
    $icon.ShowBalloonTip(8000, '${title.replace(/'/g, "''")}', '${body.replace(/'/g, "''")}', [System.Windows.Forms.ToolTipIcon]::Info)
    Write-Diag 'balloon shown'
    Start-Sleep -Seconds 9
    $icon.Dispose()
  } catch {
    Write-Diag ("balloon failed: " + $_.Exception.Message)
  }
}
`
}

/**
 * Show the desktop notification.
 *
 * Deliberately NOT `detached: true`: on Windows a detached PowerShell 5.1
 * starts and exits immediately without running the command, with exit code 0
 * and no error, which makes the channel report success while showing nothing.
 * A plain ignored-stdio child plus `unref()` keeps the turn from waiting and
 * still outlives the host process.
 */
export function sendDesktop(title, body, sound = 'fallback', aumid = 'com.deepseek.dsh') {
  if (process.platform !== 'win32') return false
  const exe = powershellPath()
  const encoded = Buffer.from(buildDesktopScript(title, body, sound, aumid, DESKTOP_LOG_PATH), 'utf16le').toString('base64')
  try {
    const child = spawn(
      exe,
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { stdio: 'ignore', windowsHide: true },
    )
    child.on('error', (error) => reporter(`desktop spawn failed (${exe}): ${error.message}`))
    child.unref()
    return true
  } catch (error) {
    reporter(`desktop spawn threw (${exe}): ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * Fan one event out to every enabled channel.
 * @returns the names of the channels that reported delivery.
 */
export async function notify(config, { title, body }) {
  const delivered = []
  const tasks = []
  if (config.telegram?.enabled !== false && config.telegram?.botToken && config.telegram?.chatId) {
    tasks.push(sendTelegram(config.telegram, title, body).then((ok) => ok && delivered.push('telegram')))
  }
  if (config.desktop !== false) {
    const aumid = typeof config.desktopAppId === 'string' && config.desktopAppId.trim() !== ''
      ? config.desktopAppId.trim()
      : 'com.deepseek.dsh'
    if (sendDesktop(title, body, config.desktopSound ?? 'fallback', aumid)) delivered.push('desktop')
  }
  await Promise.allSettled(tasks)
  return delivered
}
