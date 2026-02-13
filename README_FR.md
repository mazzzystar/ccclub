[English](./README.md) | [中文](./README_CN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Español](./README_ES.md)

# ccclub.dev

Découvrez combien de Claude Code vos amis consomment.

```
$ npx ccclub rank

  Ada's club
  DAILY · 2025-02-13 → 2025-02-14 · 3 members

  #   Name              Tokens          Cost     Calls
  →1   Ada              481,200        $7.22       142
   2   Bob              203,800        $3.06        87
   3   Carol             98,500        $1.48        53

  Dashboard: https://ccclub.dev/g/R4NK7D
```

## Pour commencer

```bash
npx ccclub init
```

Entrez votre nom et vous obtiendrez un code d'invitation à 6 caractères. Partagez-le avec vos amis :

```bash
npx ccclub join R4NK7D
```

C'est tout. L'utilisation se synchronise automatiquement toutes les heures. Pas de configuration, pas d'inscription, pas de compte.

## Comment ça marche

```
~/.claude/projects/*.jsonl → agrégation en blocs de 5h → upload → consultation commune
```

CCClub lit les logs JSONL que Claude Code écrit localement, les regroupe en résumés de 5 heures (nombre de tokens + coût) et envoie ces chiffres. **Aucun prompt, aucun code, aucun chemin de fichier, aucun nom de projet** — uniquement des compteurs. Exécutez `ccclub show-data` pour vérifier exactement ce qui est envoyé.

## Commandes

Au quotidien, ces quatre commandes suffisent :

```bash
ccclub init                        # Configuration initiale, crée un groupe
ccclub join <CODE>                 # Rejoindre le groupe d'un ami
ccclub sync                        # Synchronisation manuelle (aussi automatique chaque heure)
ccclub rank                        # Voir l'utilisation du jour
```

Autres périodes :

```bash
ccclub rank -p weekly              # Cette semaine
ccclub rank -p monthly             # Ce mois
ccclub rank -p all-time            # Depuis le début
ccclub rank --global               # Tous les utilisateurs publics
ccclub rank -g R4NK7D              # Groupe spécifique
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
https://ccclub.dev/g/R4NK7D
```

Sélecteur de période (jour/semaine/mois/tout), avatars, rafraîchissement automatique toutes les 5 minutes. La page globale des utilisateurs publics est accessible à `/g/global`.

## Confidentialité

Seules **ces données** sont envoyées :

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

**Privé par défaut** — vous n'êtes visible que dans les groupes que vous avez rejoints. Le classement global est optionnel (`ccclub profile --public`).

## Licence

MIT
