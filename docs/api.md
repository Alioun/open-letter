# HTTP API

Public read endpoints require a short-lived session token from `/api/session`
(when `REQUIRE_API_TOKEN` is on) and are per-IP rate-limited. The admin API lives
under `/api/admin/*` behind the admin login and is not listed here.

| Method | Path                              | Description                                              |
| ------ | --------------------------------- | -------------------------------------------------------- |
| `GET`  | `/api/health`                     | Health check — `{ok, db}`, returns 503 if DB unreachable |
| `GET`  | `/api/version`                    | Build info — `{commit, letter, env, runtime, startedAt}` (no-store) |
| `GET`  | `/api/session`                    | Issue a short-lived (30 min) public session token — `{token, expiresIn}` |
| `GET`  | `/api/stats`                      | Signature totals + milestones/goal (token-gated read)   |
| `GET`  | `/api/signers`                    | Verified signers list (paginated, filterable)            |
| `GET`  | `/api/occupations`                | Occupation aggregates (token-gated read)                |
| `GET`  | `/api/kreisverband-stats`         | Per-Kreisverband counts (token-gated read)              |
| `GET`  | `/api/state-stats`                | Per-German-state counts (token-gated read)              |
| `POST` | `/api/sign`                       | Submit a signature — triggers verification email         |
| `POST` | `/api/resend-verification`        | Re-send the verification email for a pending signature   |
| `GET`  | `/api/confirm/:token`             | Email confirmation link — verifies + redirects           |
| `GET`  | `/i/:code`                        | Invite page (no analytics); `#s=<token>` shows private stats |
| `GET`  | `/api/invite/:code`               | `{firstName\|null}` for an invite link; 30/15 min per IP  |
| `POST` | `/api/invite-stats`               | `{code, token}` → `{count}` or `{below}`; 20/15 min per IP |
| `POST` | `/api/request-deletion`           | Request a signature-deletion link by email               |
| `GET`  | `/api/delete/:token`              | Delete a signature via a deletion-link token             |
| `GET`  | `/api/unsubscribe/:token`         | Newsletter unsubscribe state                             |
| `POST` | `/api/unsubscribe/:token/opt-out` | Opt out of newsletter emails                             |
| `POST` | `/api/unsubscribe/:token/delete`  | Delete signature from a newsletter link                  |

## Event / Zoom endpoints (only when `features.zoomEvent`)

| Method | Path                          | Description                                                     |
| ------ | ----------------------------- | -------------------------------------------------------------- |
| `POST` | `/api/zoom-register`          | Register for the event (online Zoom or in-person meeting)      |
| `GET`  | `/api/zoom-count`             | Current registration count (token-gated read)                  |
| `GET`  | `/api/termin.ics`             | Calendar (ICS) file for the event                              |
| `GET`  | `/api/zoom-anmelden/:token`   | Self-service registration link (online)                        |
| `GET`  | `/api/treffen-anmelden/:token`| Self-service registration link (in-person meeting)             |
| `GET`  | `/api/zoom-abmelden/:token`   | Self-service de-registration link                              |

## POST /api/sign

```json
{
  "name": "Anna Berger",
  "email": "anna@example.org",
  "kv": "Berlin-Neukölln",
  "newsletter": true
}
```

- Rate limited: 30 requests per IP per 15 minutes (429 with `Retry-After` header)
- Validates: name >= 2 chars, valid email format
- Sanitizes all inputs (trim, strip HTML, length cap)
- Generates a UUID token with 24h expiry
- Queues the verification email as a durable job (sent via the configured provider)
- Returns `{ok: true}` regardless of whether the email already exists (no information leakage)

## GET /api/signers

| Param    | Default | Description                                          |
| -------- | ------- | ---------------------------------------------------- |
| `filter` | `alle`  | `alle`, `heute` (last 24h), `kv` (with Kreisverband) |
| `search` | —       | Search by name or Kreisverband                       |
| `limit`  | `18`    | Results per page (max 100)                           |
| `offset` | `0`     | Pagination offset                                    |

Returns `{signers: [{id, name, kreisverband, created_at}], total}`. Email addresses are never exposed.

## GET /api/confirm/:token

Verifies a signature if the token is valid and not expired. Redirects to `/?confirmed=1` on success (`/i/<invite code>?confirmed=1` when `features.inviteLinks` is on), `/?error=token-expired` on failure.

