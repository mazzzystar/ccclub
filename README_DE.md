[English](./README.md) | [中文](./README_CN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Français](./README_FR.md) | [Español](./README_ES.md)

# ccclub.dev

Finde heraus, wie viel Claude Code deine Freunde verbrauchen.

<img src="assets/demo.png" alt="ccclub rank" width="80%" />

## Erste Schritte

```bash
npx ccclub init
```

Gib deinen Namen ein und du bekommst einen 6-stelligen Einladungscode. Teile ihn mit Freunden:

```bash
npx ccclub join R4NK7D
```

Fertig. Die Nutzung wird automatisch jede Stunde synchronisiert. Keine Konfiguration, keine Registrierung, kein Account.

Sobald ein Freund beitritt, sieh dir das Ranking an:

```bash
ccclub rank
```

## So funktioniert es

```
~/.claude/projects/*.jsonl → in 5h-Blöcke aggregieren → hochladen → gemeinsam ansehen
```

CCClub liest die JSONL-Logs, die Claude Code lokal schreibt, fasst sie in 5-Stunden-Zusammenfassungen (Token-Anzahl + Kosten) zusammen und lädt diese Zahlen hoch. **Keine Prompts, kein Code, keine Dateipfade, keine Projektnamen** — nur Zähler. Mit `ccclub show-data` kannst du genau prüfen, was gesendet wird.

## Befehle

Für den Alltag reichen diese vier:

```bash
ccclub init                        # Einmalige Einrichtung, erstellt eine Gruppe
ccclub join <CODE>                 # Einer Gruppe beitreten
ccclub sync                        # Manuelle Synchronisierung (läuft auch stündlich)
ccclub rank                        # Heutige Nutzung anzeigen
```

Weitere Zeiträume:

```bash
ccclub rank -p weekly              # Diese Woche
ccclub rank -p monthly             # Dieser Monat
ccclub rank -p all-time            # Gesamter Zeitraum
ccclub rank --global               # Alle öffentlichen Nutzer
ccclub rank -g R4NK7D              # Bestimmte Gruppe
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
https://ccclub.dev/g/R4NK7D
```

Zeitraum-Umschalter (täglich/wöchentlich/monatlich/gesamt), Avatare, automatische Aktualisierung alle 5 Minuten. Die globale Seite für öffentliche Nutzer ist unter `/g/global` erreichbar.

## Datenschutz

Es werden **ausschließlich** diese Daten hochgeladen:

```json
{
  "blockStart": "2025-02-13T00:00:00Z",
  "blockEnd": "2025-02-13T05:00:00Z",
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
