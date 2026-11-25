# HTTP API

Public read endpoints require a 30-minute session token from `/api/session` when `REQUIRE_API_TOKEN` is enabled. They also apply per-IP rate limits. Admin routes under `/api/admin/*` require an administrator bearer token.

## Public routes

| Method | Path                              | Result                                                                                                                                                       |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/health`                     | `{ok, db, jobs}`. Returns 503 unless the database and the durable jobs are ready.                                                                            |
| `GET`  | `/api/health/operations`          | `{ok, checks}` for an uptime monitor. 503 unless app, mail, mail queue, and backups are all `ok`. See [operations](operations.md#monitoring).                |
| `GET`  | `/api/version`                    | `{commit, letter, env, runtime, startedAt}` with `no-store` caching.                                                                                         |
| `GET`  | `/api/session`                    | `{token, expiresIn}` for public reads.                                                                                                                       |
| `GET`  | `/api/stats`                      | Signature totals, milestones, and the current goal.                                                                                                          |
| `GET`  | `/api/signers`                    | Paginated, filtered public signer list.                                                                                                                      |
| `GET`  | `/api/occupations`                | Occupation counts.                                                                                                                                           |
| `GET`  | `/api/kreisverband-stats`         | Counts by regional affiliation.                                                                                                                              |
| `GET`  | `/api/state-stats`                | Counts by German state.                                                                                                                                      |
| `POST` | `/api/sign`                       | Submit a signature and queue its confirmation email.                                                                                                         |
| `POST` | `/api/resend-verification`        | Queue another confirmation email for a pending signature.                                                                                                    |
| `GET`  | `/api/confirm/:token`             | Confirm a signature and redirect to its result page.                                                                                                         |
| `GET`  | `/i/:code`                        | Invitation page, excluded from analytics. `#s=<token>` opens private invitation statistics.                                                                  |
| `GET`  | `/api/invite/:code`               | `{firstName\|null}`. Limited to 30 requests per IP per 15 minutes.                                                                                           |
| `POST` | `/api/invite-stats`               | Takes `{code, token}`. Returns `{count}`, `{below}`, `{min, max}`, or `{min}` according to `invite.statsMode`. Limited to 20 requests per IP per 15 minutes. |
| `POST` | `/api/request-deletion`           | Request a deletion link by email.                                                                                                                            |
| `GET`  | `/api/delete/:token`              | Delete a signature using its deletion token.                                                                                                                 |
| `GET`  | `/api/unsubscribe/:token`         | Read newsletter subscription state.                                                                                                                          |
| `POST` | `/api/unsubscribe/:token/opt-out` | Unsubscribe from newsletters.                                                                                                                                |
| `POST` | `/api/unsubscribe/:token/delete`  | Delete a signature using its newsletter link.                                                                                                                |

### Submit a signature

`POST /api/sign` accepts:

```json
{
  "name": "Anna Berger",
  "email": "anna@example.org",
  "kv": "Berlin-Neukölln",
  "newsletter": true
}
```

The route requires a name of at least two characters and a valid email address. It trims text, strips HTML, and limits input lengths. Each IP can make 30 requests per 15 minutes. Excess requests receive 429 and a `Retry-After` header.

A successful request queues a confirmation email as a durable job. Its UUID token expires after `privacy.confirmationLinkHours`, which defaults to 24 hours. The response is `{ok: true}` whether the email address is new or already registered.

### List public signers

`GET /api/signers` accepts these query parameters:

| Parameter | Default | Meaning                                                                                |
| --------- | ------- | -------------------------------------------------------------------------------------- |
| `filter`  | `alle`  | `alle`, `heute` for the last 24 hours, or `kv` for people with a regional affiliation. |
| `search`  | None    | Search by name or regional affiliation.                                                |
| `limit`   | `18`    | Page size, up to 100.                                                                  |
| `offset`  | `0`     | Number of results to skip.                                                             |

The response is `{signers: [{id, name, kreisverband, created_at}], total}`. It contains no email addresses.

### Confirm a signature

`GET /api/confirm/:token` verifies an unexpired token. Success redirects to `/?confirmed=1`, or `/i/<invite code>?confirmed=1` when invitation links are enabled. Failure redirects to `/?error=token-expired`.

## Meeting routes

These routes are available when `features.zoomEvent` is enabled.

| Method | Path                           | Result                                                                                  |
| ------ | ------------------------------ | --------------------------------------------------------------------------------------- |
| `POST` | `/api/zoom-register`           | Request registration for an online or in-person meeting.                                |
| `GET`  | `/api/zoom-count`              | Current registration count. Requires a public read token when token checks are enabled. |
| `GET`  | `/api/termin.ics`              | Meeting calendar file.                                                                  |
| `GET`  | `/api/zoom-anmelden/:token`    | Online meeting registration link.                                                       |
| `GET`  | `/api/treffen-anmelden/:token` | In-person meeting registration link.                                                    |
| `GET`  | `/api/zoom-abmelden/:token`    | Meeting cancellation link.                                                              |

## Publish content

All routes in this section require administrator authentication.

| Method | Path                              | Request or result                                                                                                        |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/admin/publication`          | Returns the revision, document, defaults, and editable-field definitions.                                                |
| `PUT`  | `/api/admin/publication`          | Takes `{document, expectedRevision}`. Returns 409 with the current revision for stale edits, or 400 for invalid content. |
| `GET`  | `/api/admin/publication/previous` | Returns the preceding published document.                                                                                |
| `POST` | `/api/admin/publication/preview`  | Takes `{document, lang, pageState}`. Returns HTML for an isolated preview.                                               |
| `POST` | `/api/admin/publication/assets`   | Takes PNG, JPEG, or WebP source bytes. Returns an immutable URL for the normalized image.                                |

Template changes also require the current publication revision. A publication that removes a template still needed by a scheduled or retrying campaign returns 409 without a revision and names the campaign. `DELETE /api/admin/templates/:id` answers the same way. `/api/boot` returns live operational data and email readiness. It does not return publication copy.

## Configure email and statistics

`GET /api/admin/email` returns setup state, readiness, and diagnostics without saved secrets. `POST` takes `expectedRevision` and an `action`:

| Action      | Additional data                  | Purpose                                                        |
| ----------- | -------------------------------- | -------------------------------------------------------------- |
| `takeover`  | None                             | Import the deployment profile into database management.        |
| `save`      | `profile`                        | Save a replacement profile.                                    |
| `test`      | `recipient`                      | Test the connection and send a setup message.                  |
| `receipt`   | `testId`                         | Confirm receipt of the identified setup message.               |
| `activate`  | None                             | Activate the validated profile and release automatic delivery. |
| `reconcile` | Attempt `scope` and `resolution` | Resolve an uncertain delivery attempt.                         |

`POST /api/admin/email/dns` checks published mailbox.org DNS records for a domain.

`GET /api/admin/statistics` returns the analytics mode, publication revision, daily series, pages, and referring domains. `PUT` takes `{mode, expectedRevision}` and publishes the mode change.

## Create and inspect campaigns

`POST /api/admin/campaigns` takes `{template_id, subject, scheduled_at, audience, request_key}`. Use `send_now: true` for immediate delivery. Selection campaigns also supply `recipient_ids`. Language overrides use `i18n`.

Generate a UUID for `request_key` and keep it when retrying the same request, including after a lost response. A new campaign returns 201. Repeating the same request returns 200 with the original ID and `replayed: true`. Reusing the key for different content returns 409 and names the campaign that already exists. Canceling a campaign retains its history record and request identity. The admin keeps one key per draft until the draft is reset, so one draft produces at most one campaign.

`GET /api/admin/campaigns/:id/recipients?offset=0` lists a campaign's saved selection in pages of 25. It returns `offset`, `savedCount`, the currently available `total`, `unavailable`, and `signers` with ID, name, and email. Deleted and unsubscribed people are omitted. The result shows current eligibility, not proof of delivery. Campaigns with dynamic audiences have no saved selection and return 400.

`POST /api/admin/campaigns/:id/stop` stops a send that has begun: one that is sending, waiting for its next try, or put back to `scheduled` while the mail service was unavailable. The campaign becomes `aborted` with the failure category `stopped-by-admin`, and the answer is `{ok, reached}` with the number of people mailed so far. The worker checks between recipients, so a mail already handed to the provider still goes out. A campaign that has not begun or is over returns 409. `POST /api/admin/campaigns/:id/retry` resumes it with everyone not yet reached.

## Other admin routes

Request bodies must be JSON objects. `null`, a list, or invalid JSON returns 400. Background jobs being unavailable returns 503 with a German message for the admin.

| Method  | Path                                         | Request or result                                                                                                                                                                |
| ------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`  | `/api/admin/login`                           | Takes `{password}`. Returns `{token}`, 401, or 429 with `Retry-After`. See [security](security.md#requests-and-authentication).                                                  |
| `POST`  | `/api/admin/logout-everywhere`               | Ends every admin session, including the caller's.                                                                                                                                |
| `GET`   | `/api/admin/backup`                          | Returns `lastSuccessAt`, `lastSuccessBytes`, `lastError`, `lastErrorAt`, `expiredRestorePoint`, and `retentionHours`. See [backups](operations.md#backups).                      |
| `POST`  | `/api/admin/signers/:id/remove`              | Erases the signature and blocks its mailbox. Returns `variants`: other sign-ups of the same mailbox (plus tags, Gmail dots) with `id`, `name`, `email`, `verified`, `createdAt`. |
| `POST`  | `/api/admin/signers/remove`                  | Takes `{ids}` (at most 100). Does the same for each in one transaction. Returns `removed` and the `variants` left.                                                               |
| `POST`  | `/api/admin/signers/:id/erase`               | Erases the signature without a block.                                                                                                                                            |
| `GET`   | `/api/admin/signers`                         | Confirmed signatures, newest first. Takes `search`, `from`, `to`, `public` (`public` or `hidden`), `limit`, `offset`. `fuzzy` marks a similar-name result.                       |
| `GET`   | `/api/admin/signers/:id`                     | One confirmed signature with its recorded consent and its `history` from the admin log.                                                                                          |
| `PATCH` | `/api/admin/signers/:id`                     | Changes the fields it names. See [editing a signature](#editing-a-signature).                                                                                                    |
| `POST`  | `/api/admin/signers/:id/newsletter-request`  | Mails the person a link to subscribe with. 409 if already subscribed.                                                                                                            |
| `POST`  | `/api/admin/signers/:id/resend-confirmation` | Mails an unconfirmed sign-up a fresh confirmation link. 409 if already confirmed.                                                                                                |
| `POST`  | `/api/admin/signers/lookup`                  | Takes `{email}`. Returns `blocked`, every sign-up of the mailbox (`signups`, unconfirmed included), recent send attempts (`mail`), and `queued`.                                 |
| `GET`   | `/api/admin/signers/blocks`                  | Returns the number of blocked mailboxes (`total`) and when each was blocked (`blocks`). Never an address.                                                                        |
| `GET`   | `/api/admin/export/signers.csv`              | The public list as CSV: what the public page shows, no addresses. `/api/admin/export/meeting-registrations.csv` likewise, with the meeting feature on.                           |
| `GET`   | `/api/admin/actions`                         | The admin log, newest first, 50 per page (`offset`). Returns `actions`, `total`, and `retentionDays`.                                                                            |
| `GET`   | `/api/admin/newsletter-signer-ids`           | Returns `ids` (the newest 20,000 matches at most), the `total` number of matches, and `truncated`.                                                                               |
| `GET`   | `/api/admin/zoom-registrations`              | Takes `limit` (default 100, at most 200) and `offset`. Returns `registrations`, `total`, and `delegates`.                                                                        |
| `POST`  | `/api/admin/merge-occupation`                | Takes `{from, to}`. `to` must pass the sign-up form's cleaning unchanged. Returns `updated` and `undoId`.                                                                        |
| `POST`  | `/api/admin/merge-kv`                        | Same for the regional group. Clears the state of merged signatures for re-resolution.                                                                                            |
| `POST`  | `/api/admin/assign-kv-state`                 | Takes `{kreisverband, state}` with one of the sixteen German states. Returns `updated` and `undoId`.                                                                             |
| `POST`  | `/api/admin/merges/:id/undo`                 | Takes back the merge or assignment with that `undoId`. Returns `restored`. Signatures edited or erased since are left alone. 409 if already undone, 404 after 30 days.           |

### Meeting registrations

`GET /api/admin/zoom-registrations` also takes `search`, part of a name or address. `matches` is the number of registrations found, while `total` and `delegates` keep counting all of them. Each registration has an `id`.

`DELETE /api/admin/zoom-registrations/:id` removes one registration and the mail queued for it, as the person's own opt-out link does. The signature stays, and the person can register again. A registration that is already gone returns 404.

### Editing a signature

`PATCH /api/admin/signers/:id` takes any of `name`, `occupation`, `signerFunction`, `kreisverband`, `lang`, `showPublicly`, `showSignerDetails`, and `newsletter`. Text fields are cleaned like a sign-up. The email address cannot be changed.

- Switching something off is immediate.
- Switching `showPublicly` or `showSignerDetails` on for a signature that had it off needs `consent: true`, otherwise the answer is 400. An optional `consentNote` is stored with the signature.
- `newsletter` only accepts `false`. `true` answers 400: the person subscribes through the mail that `newsletter-request` sends.

The answer is `{ok, changed, signer}`. Every change is written to the admin log with its old and new value.
