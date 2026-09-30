# Emails transactionnels

Source : Master Spec §15, §18, §19 ; ADR-0011 ; BR-50, BR-60. Socle livré par VTC-043 ; les emails métier (régularisation SCA, réception, acceptation…) arrivent avec leurs tickets (VTC-044 et suivants).

## Principe

Chaque email est une ligne `Notification` persistée, envoyée **après le commit** de la transaction métier et **hors de toute transaction**. Un échec est tracé sur la `Notification` et n'écrit jamais sur `Booking` ni `Payment` (BR-50, règle 10 de `CLAUDE.md`).

```
transaction métier (commit) ──► sendNotification({ kind, bookingId, dedupeKey, locale, render })
                                   │ Notification PENDING (dedupeKey unique), attempts + 1
                                   │ rendu React Email (EmailLayout FR/EN) → HTML + texte
                                   │ EmailSender (Resend, Idempotency-Key dérivée de dedupeKey)
                                   └► SENT (providerMessageId, sentAt) | FAILED (lastErrorCode)
```

## Modules

| Module                                          | Rôle                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/notifications/send-notification.ts` | Service `sendNotification` : déduplication, tentatives, rendu, envoi, traçage. **Ne lève jamais** : renvoie `sent`, `skipped` (`ALREADY_SENT`, `IN_PROGRESS`) ou `failed` avec un code.     |
| `src/integrations/email/sender.ts`              | Port `EmailSender` (mockable) et codes d'erreur techniques.                                                                                                                                 |
| `src/integrations/email/resend.ts`              | Adaptateur Resend : une tentative par appel, délai d'expiration borné (10 s par défaut), **aucune relance automatique**, erreurs du fournisseur ramenées à un code (le message est ignoré). |
| `src/integrations/email/index.ts`               | `emailSender()` câblé sur l'environnement, créé au premier usage (jamais au build).                                                                                                         |
| `src/emails/layout.tsx`, `render.ts`, `i18n.ts` | Mise en page commune (marque Avelys, `DESIGN.md`, styles inline), rendu HTML + texte, textes lus dans les catalogues `src/i18n/messages` (espaces `Email` et `Site.footer`).                |

## Déduplication et tentatives

- `dedupeKey` (≤ 255 caractères) est choisie par l'appelant, par exemple `booking:{id}:payment-action-required:{paymentId}` : **un email au plus par clé**. Une clé déjà utilisée pour une autre réservation ou un autre type est refusée (`DEDUPE_KEY_CONFLICT`).
- `SENT` : aucun nouvel envoi (`skipped` / `ALREADY_SENT`).
- `PENDING` dont la tentative a commencé il y a moins de `leaseMs` (60 s par défaut, supérieur au délai d'expiration de l'adaptateur) : un autre appel est en cours (`skipped` / `IN_PROGRESS`).
- `FAILED`, ou `PENDING` abandonné (processus interrompu) : nouvelle tentative, `attempts + 1`. La prise de la tentative est un compare-and-set sur `attempts` : entre appels concurrents, un seul envoie (test d'intégration).
- En-tête `Idempotency-Key` Resend = `avelys-notification-` + SHA-256 de `dedupeKey` : stable d'une tentative à l'autre, sans contenu lisible. Couvre le cas d'un envoi accepté après expiration du délai côté application (Resend conserve la clé 24 h).
- Relancer = rappeler `sendNotification` avec la même clé **et la fonction de rendu du `kind`** (aucun contenu n'est stocké). Pas de file d'attente, de tâche planifiée ni d'action admin ici (hors périmètre, à venir avec leurs tickets). Procédure opérateur : `docs/infra/runbooks.md` (RB-04).

### Limites de la garantie « un seul envoi »

La base garantit une seule tentative à la fois par clé ; l'absence de doublon côté destinataire repose ensuite sur l'idempotence Resend, qui ne vaut que **pendant 24 h et pour un contenu identique** :

- une tentative expirée côté application (`EMAIL_TIMEOUT`, `EMAIL_NETWORK_ERROR`) mais délivrée, relancée **après 24 h**, produit un **second email** ;
- une relance dont le rendu **diffère** de la tentative initiale est refusée par Resend (`EMAIL_IDEMPOTENCY_CONFLICT`) : la notification reste `FAILED` alors que le premier email a pu être délivré.

En conséquence :

- **les templates doivent produire un rendu déterministe pour une `dedupeKey` donnée** (sujet, HTML et texte ne dépendent que de la réservation et de la clé, jamais de l'heure courante ni d'une valeur aléatoire) ; toute évolution d'un template en production se fait avec de nouvelles clés ;
- avant une relance manuelle, l'opérateur vérifie dans le dashboard Resend que l'email n'est pas déjà parti.

## Codes d'échec (`lastErrorCode`)

| Code                         | Cause                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `EMAIL_NOT_CONFIGURED`       | `RESEND_API_KEY` ou `EMAIL_FROM` absent                                                                         |
| `EMAIL_TIMEOUT`              | Pas de réponse dans le délai (l'email a pu partir : la clé d'idempotence protège un renvoi identique sous 24 h) |
| `EMAIL_NETWORK_ERROR`        | API injoignable                                                                                                 |
| `EMAIL_AUTH_FAILED`          | Clé absente, invalide ou restreinte côté Resend                                                                 |
| `EMAIL_REJECTED`             | Champ, expéditeur ou destinataire refusé                                                                        |
| `EMAIL_RATE_LIMITED`         | Limite de débit ou quota                                                                                        |
| `EMAIL_IDEMPOTENCY_CONFLICT` | Même clé d'idempotence avec un autre contenu, ou requête concurrente                                            |
| `EMAIL_PROVIDER_ERROR`       | Autre erreur fournisseur ou réponse inattendue                                                                  |
| `EMAIL_RENDER_FAILED`        | Le template a levé une erreur ; rien n'est envoyé                                                               |

Sans ligne écrite : `INVALID_NOTIFICATION` (entrée invalide), `BOOKING_NOT_FOUND`, `INTERNAL_ERROR` (base indisponible…).

## Données personnelles et secrets

- **Ni adresse ni contenu stockés** (BR-60) : le destinataire (`Customer.email` de la réservation) est lu au moment de l'envoi. Test de schéma : aucune colonne d'adresse ou de contenu sur `Notification`.
- Logs `notification.sent` / `notification.failed` : `bookingRef`, `kind`, `notificationId`, `attempts`, `code`, et pour diagnostic le nom d'erreur et le statut HTTP du fournisseur (`providerError`, `statusCode`) ou le nom d'une exception (`errorName`) ; jamais de message d'erreur, d'adresse, de sujet ni de corps. Le logger masque aussi `RESEND_API_KEY`, `to`, `replyTo`, `recipient`.
- Le SDK Resend écrit ses erreurs sur `console.error` hors production (le message peut citer l'adresse) : l'adaptateur neutralise cette sortie.
- Rétention et purge des notifications : DEC-11 (hors périmètre).

## Configuration

| Variable         | Rôle                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY` | Clé API Resend (secret). Facultative : absente → `EMAIL_NOT_CONFIGURED`. Clés séparées dev/staging/prod (ADR-0011). |
| `EMAIL_FROM`     | Expéditeur, `adresse` ou `Nom <adresse>`. **Provisoire, configurable** : domaine définitif et SPF/DKIM = DEC-01b.   |
| `EMAIL_REPLY_TO` | Adresse de réponse facultative.                                                                                     |

Toutes facultatives et lues au premier envoi : `pnpm build` passe sans elles. Les tests d'intégration forcent `RESEND_API_KEY` et `EMAIL_FROM` vides : aucun test n'envoie de vrai email. Vérification manuelle facultative par le propriétaire avec une clé Resend de test, vers sa propre adresse.

## Mise en page

`EmailLayout` (FR/EN) : logotype Avelys, corps du template, bandeau encre avec l'accroche du site et l'identité de la société reprise de `src/lib/site-identity.ts`, chaque valeur non décidée affichant le placeholder provisoire (DEC-08 / DEC-20). **Aucune mention légale ni condition d'annulation ou de remboursement** dans la mise en page. Rendu FR et EN couvert par un instantané texte (`src/emails/layout.test.ts`).
