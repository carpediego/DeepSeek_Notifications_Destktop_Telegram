# Changelog

## 1.1.0

- Las notificaciones muestran el **nombre de la conversación** en vez del id corto de la sesión (`Sesión ea7c12`). El título se toma del evento `session/title` que anuncia DSH; si todavía no llegó, se usa el nombre de la carpeta del proyecto, y solo como último recurso el id.
- El log de diagnóstico ahora incluye el cuerpo del aviso, no solo el título.
- El test cubre las dos rutas del nombre (título anunciado y carpeta) y falla si el id corto aparece en un aviso.

## 1.0.0

- Primera versión: avisos por Telegram y toast de Windows para turno terminado, error y aprobación pendiente.
- Instalación por fila `insert` en el patch del perfil (el patch de bundle no se monta en 0.2.1-rc.5).
- Toast sin `detached` (en Windows el hijo detached no ejecuta el comando).
