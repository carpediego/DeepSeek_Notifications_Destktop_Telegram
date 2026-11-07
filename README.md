# DeepSeek Notifications — escritorio + Telegram

Notificaciones de **DeepSeek Harness (DSH)** cuando un turno termina, cuando falla y cuando una herramienta espera tu aprobación.

Dos canales, sin dependencias externas:

| Canal | Dónde aparece | Plataforma |
| --- | --- | --- |
| **Escritorio** | Toast nativo de Windows, atribuido a *DeepSeek Harness* | Windows 10/11 |
| **Telegram** | Mensaje del bot en tu chat privado | Cualquiera |

No registra UI, ni herramientas para el modelo, ni bundle de cliente: es un plugin de host que solo escucha eventos. Si algo falla, queda en un log; nunca rompe la ventana ni el turno.

---

## Requisitos

- DeepSeek Harness **0.2.x** (probado en `0.2.1-rc.5`; el mecanismo de carga se verificó contra esa versión).
- Node.js **22+** para los scripts de instalación y prueba (el que trae DSH sirve).
- Para el canal de escritorio: Windows 10/11 con notificaciones activas.
- Para Telegram: un bot propio (se crea en 2 minutos, gratis).

---

## Instalación asistida por IA

Copiá el bloque de abajo y pegáselo a un agente con acceso a terminal (Claude Code, Cursor, el propio DSH, etc.). El agente pide lo único que no puede adivinar —el token del bot— y hace el resto.

```text
Instalá el plugin de notificaciones descrito en:
https://github.com/carpediego/DeepSeek_Notifications_Destktop_Telegram

Seguí estos pasos, en orden, sin saltearte ninguno:

1. Detectá el entorno de DSH: usá $env:DSH_HOME (Windows) o $DSH_HOME, y si no
   está definido asumí %USERPROFILE%\.dsh. Detectá también el perfil activo con
   $env:DSH_PROFILE / $DSH_PROFILE y listá $DSH_HOME\profiles si no está claro.
   Verificá la versión de DSH y avisá si no es 0.2.x.

2. Copiá la carpeta del plugin a $DSH_HOME\plugins\dsh-turn-notify (creá el
   directorio si no existe). No copies node_modules ni logs.

3. Creá $DSH_HOME\turn-notify.json a partir de turn-notify.example.json, sin
   token todavía.

4. Abrí $DSH_HOME\profiles\<perfil>\cordis.patch.yml y agregá al final de la
   lista esta entrada, reemplazando <RUTA> por la ruta absoluta real del
   archivo lib/index.js, con barras normales y prefijo file:///:

   - insert:
       - id: turn-notify
         name: 'file:///<RUTA>/lib/index.js'

   IMPORTANTE: va en la capa de usuario del perfil, NO como patch de un bundle.
   En 0.2.1-rc.5 las filas insertadas por un bundle se componen pero no se
   montan, y el plugin queda cargado en el papel y muerto en la práctica.

5. Pedile al usuario el token del bot de Telegram (formato 123456789:AAH...).
   Si no tiene bot, explicale: en Telegram, hablar con @BotFather, /newbot,
   elegir nombre y username terminado en "bot", y copiar el token.
   Pedile también que le escriba cualquier mensaje al bot antes de seguir.

6. Con el token, ejecutá desde la carpeta del plugin:
   node test/telegram-setup.mjs "<TOKEN>"
   El script valida el token, detecta solo el chat id, escribe la config y
   manda un mensaje de prueba. Si falla, no sigas: reportá el error.

7. Reiniciá DSH (cerrar y abrir la app de escritorio). El plugin se carga solo
   al arrancar.

8. Verificá en $DSH_HOME\turn-notify.log que aparezcan las líneas
   "module-evaluated" y "apply". Si el archivo no existe, el plugin no se está
   montando: revisá el paso 4.

9. Reportá: versión de DSH, ruta donde quedó el plugin, perfil usado, resultado
   de la prueba de Telegram y si el toast de Windows apareció.

No imprimas el token en la salida ni lo subas a ningún lado. No modifiques
otros plugins ni el resto de cordis.patch.yml.
```

---

## Instalación manual

### 1. Copiar el plugin

```powershell
# Windows
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\plugins" | Out-Null
Copy-Item -Recurse ".\dsh-turn-notify" "$env:USERPROFILE\.dsh\plugins\dsh-turn-notify"
```

```bash
# Linux / macOS
mkdir -p "$HOME/.dsh/plugins"
cp -R ./dsh-turn-notify "$HOME/.dsh/plugins/dsh-turn-notify"
```

### 2. Crear la configuración

```powershell
Copy-Item "$env:USERPROFILE\.dsh\plugins\dsh-turn-notify\turn-notify.example.json" `
          "$env:USERPROFILE\.dsh\turn-notify.json"
```

### 3. Montar el plugin

Editá `$DSH_HOME/profiles/<perfil>/cordis.patch.yml` (en la app de escritorio el perfil es `desktop`) y agregá al final:

```yaml
- insert:
    - id: turn-notify
      name: 'file:///C:/Users/<usuario>/.dsh/plugins/dsh-turn-notify/lib/index.js'
```

La ruta tiene que ser **absoluta**, con barras normales y prefijo `file:///`. En Linux/macOS queda `file:///home/<usuario>/...`.

### 4. Configurar Telegram

En Telegram: **@BotFather** → `/newbot` → nombre → username terminado en `bot` → copiá el token.

Escribile cualquier mensaje a tu bot nuevo (un bot no puede iniciar el chat).

Después, desde la carpeta del plugin:

```powershell
node test\telegram-setup.mjs "<TOKEN>"
```

El script valida el token, espera tu mensaje, detecta el `chat id` solo, lo guarda y manda una prueba por el código real del plugin.

### 5. Reiniciar DSH

Cerrá y abrí la aplicación. El plugin se carga al arrancar.

---

## Configuración

Archivo: `$DSH_HOME/turn-notify.json`. Se relee en **cada evento**: cambiar el token, el chat o apagar un canal no requiere reiniciar DSH.

| Campo | Default | Qué hace |
| --- | --- | --- |
| `desktop` | `true` | Activa el toast de Windows |
| `desktopAppId` | `com.deepseek.dsh` | AUMID con el que Windows atribuye el toast. Si no está registrado, cae al de Windows PowerShell |
| `desktopSound` | `"fallback"` | `"fallback"` pitido solo si el toast falla · `"always"` siempre · `"off"` nunca |
| `minTurnDurationMs` | `5000` | Ignora turnos más cortos (evita spam en respuestas rápidas) |
| `notifyOnError` | `true` | Avisa cuando el turno falla |
| `notifyOnApproval` | `true` | Avisa cuando una herramienta espera aprobación |
| `telegram.enabled` | `true` | Apaga solo Telegram |
| `telegram.botToken` | — | Token de @BotFather |
| `telegram.chatId` | — | Lo completa `telegram-setup.mjs` |

Ejemplo completo en [`turn-notify.example.json`](turn-notify.example.json).

### Apagar el canal de escritorio

```json
{ "desktop": false, "telegram": { "enabled": true, "botToken": "...", "chatId": "..." } }
```

### Qué llega

| Evento | Título | Cuerpo |
| --- | --- | --- |
| Turno terminado | `DSH terminó` | `<conversación> · <duración>` |
| Error | `DSH error` | `<conversación> · <mensaje>` |
| Aprobación pendiente | `DSH necesita tu aprobación` | `<conversación>` |

`<conversación>` se resuelve en este orden, y el primero que exista gana:

1. El **título de la conversación** que anuncia DSH (evento `session/title`).
2. El nombre de la **carpeta del proyecto** del directorio de trabajo de la sesión.
3. `Sesión <id corto>`, solo si no hay ninguna de las dos.

Ejemplo de aviso: `DSH terminó` → `Arreglar el carrito de compras · 2m 14s`.

---

## Verificación y diagnóstico

```powershell
node test\run.mjs                                     # cableado de eventos, sin red
node test\send-test.mjs                               # manda un aviso real ahora
node test\telegram-setup.mjs "<TOKEN>"                # configura Telegram desde cero
```

Logs:

| Archivo | Qué contiene |
| --- | --- |
| `$DSH_HOME/turn-notify.log` | Carga del plugin (`module-evaluated`, `apply`) y cada envío con sus canales |
| `$DSH_HOME/turn-notify-desktop.log` | Qué hizo el PowerShell que muestra el toast |

Si el log del plugin no existe después de reiniciar, el problema es el **paso 3**: la fila no se está montando.

Si el toast no aparece pero `turn-notify-desktop.log` dice `toast shown`, el problema es de Windows, no del plugin: revisá *Configuración → Sistema → Notificaciones* y que *No molestar* esté apagado.

---

## Notas de diseño (por qué el código hace cosas raras)

Cuatro comportamientos de DSH y Windows que no son obvios y que el código evita a propósito:

1. **Las filas insertadas por un patch de bundle no se montan.** En `0.2.1-rc.5` aparecen en `dsh --dump-config` y aun así el módulo nunca se importa. Por eso la instalación es una fila `insert` en la capa de usuario del perfil, con URL `file://`.

2. **`spawn(..., { detached: true })` no ejecuta PowerShell en Windows.** El proceso arranca y sale de inmediato con exit code `0` y sin error, así que el canal informa éxito mientras no muestra nada. El plugin lanza el hijo sin `detached`, con `stdio: 'ignore'` y `unref()`, que además sobrevive al cierre del host.

3. **Un toast con AUMID no registrado se acepta pero no se dibuja.** Windows lo guarda en el historial y no muestra el banner, que se ve igual que "no pasó nada". El toast usa el AUMID de la app (`com.deepseek.dsh`) y cae al de Windows PowerShell si no existe.

4. **El título de la conversación no está en `session.header`.** Llega como evento `session/title` (`{ title, messageSeqs, source }`), y `header.title` suele estar vacío. El plugin escucha ese evento y guarda el último título por sesión; si todavía no llegó ninguno, usa el nombre de la carpeta del proyecto (`header.cwd`) y solo como último recurso el id corto.

También: los canales son *fire-and-forget*. Un proveedor caído nunca rechaza el turno ni escribe en el resultado del agente.

---

## Compatibilidad

- **DSH 0.2.x**: es el target. Probado en `0.2.1-rc.5` y `0.2.2-rc.1`. Los plugins públicos de notificación declaran `0.1.7`, y DSH rechaza instalarlos en 0.2.x — de ahí que este exista.
- **DSH 0.1.x**: no probado. Los eventos (`agent/status`, `agent/error`, `approval/request`) existen desde antes, pero el mecanismo de carga cambió.
- Si upstream arregla el montaje de bundles, el paso 3 se puede simplificar; el resto sigue igual.

## Limitaciones

- El canal de escritorio es **solo Windows** (usa PowerShell + WinRT). En Linux/macOS usá Telegram.
- El aviso es una línea de texto: no hay botones, ni deep link al turno, ni historial.
- El toast no parte el texto en varias líneas: un cuerpo muy largo se ve recortado.
- No persiste nada: si el host estaba cerrado, ese turno no se notifica.

## Seguridad

- El token de Telegram queda en `$DSH_HOME/turn-notify.json`, en texto plano, legible solo por tu usuario. Ese archivo está en `.gitignore` y **nunca** debe subirse.
- Si el token se filtra, se revoca con `/revoke` en @BotFather y se genera otro.
- El plugin no hace red saliente más que a `api.telegram.org`.

## Licencia

MIT — ver [LICENSE](LICENSE).
