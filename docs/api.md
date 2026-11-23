# HTTP API

Public read endpoints require a 30-minute session token from `/api/session` when `REQUIRE_API_TOKEN` is enabled. They also apply per-IP rate limits. Admin routes under `/api/admin/*` require an administrator bearer token.

## Public routes

| Method | Path                              | Result                                                                                                                                                       |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/health`                     | `{ok, db}`. Returns 503 if the database is unreachable.                                                                                                      |
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

Template changes and legacy copy mutations also require the current publication revision. `/api/boot` returns live operational data and email readiness. It does not return publication copy.

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

Generate a UUID for `request_key` and keep it when retrying the same request, including after a lost response. A new campaign returns 201. Repeating the same request returns 200 with the original ID and `replayed: true`. Reusing the key for different content returns 409. Canceling a campaign retains its history record and request identity.

`GET /api/admin/campaigns/:id/recipients?offset=0` lists a campaign's saved selection in pages of 25. It returns `offset`, `savedCount`, the currently available `total`, `unavailable`, and `signers` with ID, name, and email. Deleted and unsubscribed people are omitted. The result shows current eligibility, not proof of delivery. Campaigns with dynamic audiences have no saved selection and return 400.
