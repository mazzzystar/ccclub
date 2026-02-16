[English](../README.md) | [中文](./README_CN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Español](./README_ES.md)

# ccclub.dev

Un leaderboard multijoueur pour Claude Code.

<img src="./demo.png" alt="ccclub" width="80%" />

## Pour commencer

```bash
npx ccclub init
```

Entrez votre nom et vous obtiendrez un code d'invitation à 6 caractères. Partagez-le avec vos amis :

```bash
npx ccclub join YHAW6P
```

C'est tout. L'utilisation se synchronise automatiquement toutes les heures. Pas de configuration, pas d'inscription, pas de compte.

Une fois qu'un ami rejoint, consultez le classement :

```bash
ccclub
```

## Données uploadées

CCClub lit les logs d'utilisation locaux (`~/.claude/projects/`) que Claude Code écrit déjà, les regroupe en résumés horaires (nombre de tokens + coût) et envoie uniquement ces chiffres. **Aucun prompt, aucun code, aucun chemin de fichier, aucun nom de projet** — uniquement des compteurs. Exécutez `ccclub show-data` pour vérifier exactement ce qui est envoyé.

## Commandes

Au quotidien, ces quatre commandes suffisent :

```bash
ccclub init                        # Configuration initiale, crée un groupe
ccclub join <CODE>                 # Rejoindre le groupe d'un ami
ccclub sync                        # Synchronisation manuelle (aussi en fin de session)
ccclub                             # Voir l'utilisation du jour
```

Plus d'options :

```bash
ccclub -d 7                        # Fenêtre : 7 / 30 / all
ccclub --global                    # Tous les utilisateurs publics
ccclub -g YHAW6P                   # Groupe spécifique
```

Fonctions avancées :

```bash
ccclub create                      # Créer un autre groupe
ccclub profile                     # Voir votre profil
ccclub profile --name "Nouveau"    # Changer le nom d'affichage
ccclub profile --avatar "URL"      # Avatar personnalisé
ccclub profile --public            # Apparaître dans le classement global
ccclub profile --private           # Se cacher du classement global (par défaut)
ccclub show-data                   # Voir les données envoyées
```

## Tableau de bord web

Chaque groupe a sa page en direct :

```
https://ccclub.dev/g/YHAW6P
```

Sélecteur de période (today/7d/30d/all time), avatars, rafraîchissement automatique toutes les 5 minutes. La page globale des utilisateurs publics est accessible à `/g/global`.

## Confidentialité

Seules **ces données** sont envoyées :

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

**Privé par défaut** — vous n'êtes visible que dans les groupes que vous avez rejoints. Le classement global est optionnel (`ccclub profile --public`).

## Licence

MIT
