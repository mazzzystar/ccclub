[English](../README.md) | [中文](./README_CN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Français](./README_FR.md)

# ccclub.dev

Un leaderboard multijugador para Claude Code.

<img src="./demo.png" alt="ccclub" width="80%" />

## Empezar

```bash
npx ccclub init
```

Introduce tu nombre y recibirás un código de invitación de 6 caracteres. Compártelo con tus amigos:

```bash
npx ccclub join YHAW6P
```

Listo. El uso se sincroniza automáticamente cada hora. Sin configuración, sin registro, sin cuenta.

Cuando un amigo se una, revisa el ranking:

```bash
ccclub
```

## Datos que se suben

CCClub lee los logs de uso locales (`~/.claude/projects/`) que Claude Code ya escribe, los agrupa en resúmenes por hora (cantidad de tokens + costo) y sube solo esos números. **Sin prompts, sin código, sin rutas de archivos, sin nombres de proyecto** — solo contadores. Ejecuta `ccclub show-data` para verificar exactamente qué se envía.

## Comandos

Para el uso diario, estos cuatro son suficientes:

```bash
ccclub init                        # Configuración inicial, crea un grupo
ccclub join <CODE>                 # Unirse al grupo de un amigo
ccclub sync                        # Sincronización manual (también al finalizar sesión)
ccclub                             # Ver el uso de hoy
```

Más opciones:

```bash
ccclub -d 7                        # Ventana de tiempo: 7 / 30 / all
ccclub --global                    # Todos los usuarios públicos
ccclub -g YHAW6P                   # Grupo específico
```

Funciones adicionales:

```bash
ccclub create                      # Crear otro grupo
ccclub profile                     # Ver tu perfil
ccclub profile --name "Nuevo"      # Cambiar nombre de pantalla
ccclub profile --avatar "URL"      # Avatar personalizado
ccclub profile --public            # Aparecer en el ranking global
ccclub profile --private           # Ocultarse del ranking global (por defecto)
ccclub show-data                   # Ver los datos que se suben
```

## Panel web

Cada grupo tiene su página en vivo:

```
https://ccclub.dev/g/YHAW6P
```

Selector de período (today/7d/30d/all time), avatares, actualización automática cada 5 minutos. La página global de usuarios públicos está en `/g/global`.

## Privacidad

Se suben **únicamente** estos datos:

```json
{
  "blockStart": "2025-02-13T00:00:00Z",
  "blockEnd": "2025-02-13T01:00:00Z",
  "inputTokens": 48210,
  "outputTokens": 12050,
  "cacheCreationTokens": 0,
  "cacheReadTokens": 31200,
  "totalTokens": 91460,
  "costUSD": 0.2184,
  "models": ["claude-sonnet-4-5-20250929"],
  "entryCount": 23
}
```

**Privado por defecto** — solo eres visible en los grupos a los que te has unido. El ranking global es opcional (`ccclub profile --public`).

## Licencia

MIT
