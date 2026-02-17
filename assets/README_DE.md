[English](../README.md) | [中文](./README_CN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Français](./README_FR.md) | [Español](./README_ES.md)

# ccclub.dev

Claude Code Leaderboard unter Freunden.

<img src="./demo.png" alt="ccclub" width="80%" />

## Erste Schritte

```bash
npx ccclub init
```

Gib deinen Namen ein und du bekommst einen 6-stelligen Einladungscode. Teile ihn mit Freunden:

```bash
npx ccclub join YHAW6P
```

Fertig. Die Nutzung wird automatisch per Claude Code Hook synchronisiert. Keine Konfiguration, keine Registrierung, kein Account.

Sobald ein Freund beitritt, sieh dir das Ranking an:

```bash
ccclub
```

## Was wird hochgeladen

ccclub liest die lokalen Nutzungslogs (`~/.claude/projects/`), die Claude Code bereits schreibt, fasst sie in 30-Minuten-Zusammenfassungen (Token-Anzahl + Kosten) zusammen und lädt nur diese Zahlen hoch. **Keine Prompts, kein Code, keine Dateipfade, keine Projektnamen** — nur Zähler. Mit `ccclub show-data` kannst du genau prüfen, was gesendet wird.

## Befehle

Für den Alltag reichen diese vier:

```bash
ccclub init                        # Einmalige Einrichtung, erstellt eine Gruppe
ccclub join <CODE>                 # Einer Gruppe beitreten
ccclub sync                        # Manuelle Synchronisierung (auch bei Sitzungsende)
ccclub                             # Leaderboard anzeigen
```

Weitere Optionen:

```bash
ccclub -d 7                        # Zeitfenster: 7 / 30 / all
ccclub --global                    # Alle öffentlichen Nutzer
ccclub -g YHAW6P                   # Bestimmte Gruppe
```

Weitere Funktionen:

```bash
ccclub create                      # Neue Gruppe erstellen
ccclub profile                     # Profil anzeigen
ccclub profile --name "Neuer Name" # Anzeigename ändern
ccclub profile --avatar "URL"      # Eigener Avatar
ccclub profile --public            # Im globalen Ranking anzeigen
ccclub profile --private           # Aus globalem Ranking ausblenden (Standard)
ccclub show-data                   # Hochgeladene Daten einsehen
```

## Web-Dashboard

Jede Gruppe hat eine Live-Seite:

```
https://ccclub.dev/g/YHAW6P
```

Zeitraum-Umschalter (today/7d/30d/all time), Avatare, automatische Aktualisierung alle 5 Minuten. Die globale Seite für öffentliche Nutzer ist unter `/g/global` erreichbar.

## Datenschutz

Es werden **ausschließlich** diese Daten hochgeladen:

```json
{
  "blockStart": "2025-02-13T00:00:00Z",
  "blockEnd": "2025-02-13T00:30:00Z",
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

**Standardmäßig privat** — du bist nur in Gruppen sichtbar, denen du beigetreten bist. Das globale Ranking ist Opt-in (`ccclub profile --public`).

## Lizenz

MIT
