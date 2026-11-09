# Configuration

Each letter has a directory under `config/letters/<name>/`. Its `index.js` defines the initial configuration; `content.jsx` contains the letter and FAQ. Environment variables supply secrets and server settings.

An optional `letter.css` in that directory is bundled with public pages. Scope its rules to `[data-letter="<name>"]`, the attribute on `<html>`. The admin interface does not load it.

After the first publication, the database supplies published content and templates. Changing deployment defaults does not replace a publication. See [publishing](publishing.md) for runtime editing.

## Letter config

| Key                     | Purpose                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `brand`                 | Name, wordmark, language, and locale.                                                                                                 |
| `theme`                 | Colors, fonts, spacing, borders, and shadows. See below.                                                                              |
| `meta`                  | Page title, descriptions, canonical URL, social metadata, favicon, JSON-LD `schemaAbout`, and optional external `analytics` settings. |
| `privacy`               | Retention periods and link lifetimes. The server enforces them and the privacy policy quotes them.                                    |
| `hero`                  | Headline lines, buttons, counter labels, and initial `milestones`.                                                                    |
| `nav`, `navCta`, `list` | Navigation items, main navigation button, and signer-list heading.                                                                    |
| `sign`                  | Heading, participation criteria, privacy note, form copy, and optional field definitions.                                             |
| `footer`, `legal`       | Footer, contact, responsible entity, address, and legal notice.                                                                       |
| `email`                 | Sender, signoff, provider, SMTP defaults, provider retention, pacing, and initial templates.                                          |
| `pages`                 | Copy for confirmation, deletion, and meeting pages. Defaults are in `server/pages.js`.                                                |
| `features`              | Optional modules listed below.                                                                                                        |
| `ui`                    | Other public interface copy, including server messages under `ui.server`. Language defaults are in `config/ui.js`.                    |
| `invite`                | Invitation copy and private statistics rules. Defaults are in `config/invite.js`.                                                     |
| `zoom`                  | Meeting label, date, and duration when `features.zoomEvent` is enabled.                                                               |
| `languages`, `i18n`     | Enabled languages and overrides when `features.multiLanguage` is enabled.                                                             |

### Theme and form fields

`theme.colors` becomes CSS variables. Optional colors include `onAkzent`, `ctaBg`, `ctaFg`, `goalFill`, `ctaHoverBg`, `ctaHoverFg`, `heroBg`, and `statBg`. The theme also supplies email and generated-image styling.

`theme.fonts` selects `display` and `body` fonts. `theme.style` accepts `shadowOffset`, `radius`, and `borderWidth`, plus `cardRadius`, `buttonRadius`, `headlineMaxWidth`, `inputRadius`, `checkRadius`, `bannerRadius`, and `bannerPadBottom`. Cards default to 16 px corners; buttons and inputs default to 10 px. Set radius values to `"0"` for square corners. `shadowOffset: "none"` removes offset shadows, including on mail-link pages. `shadow: "soft"` selects blurred shadows.

`sign.fields` controls labels and placeholders for `kreisverband` and `occupation`. The regional field also accepts `options` for a server-validated fixed list, `selectPlaceholder`, `pluralLabel`, `noneLabel`, and `rowPrefix`.

Feature flags are `kreisverbandField`, `occupationField`, `germanyMap`, `stateResolution`, `zoomEvent`, `inviteLinks`, and `multiLanguage`. The map and state resolver currently use Germany.

Invitation statistics use `statsMode` with `ranges` as the default, or `threshold` or `exact`. Configure `statsRanges` or `statsThreshold` for the chosen mode. Invitation copy accepts `{firstName}`, `{title}`, and `{url}`.

## Languages

Without `features.multiLanguage`, the letter uses `brand.lang`. With the flag enabled, declare the languages and their overrides:

```js
features: { multiLanguage: true },
languages: ["de", "en"],
i18n: {
  en: {
    meta: { title: "…", description: "…" },
    hero: { headlineLines: ["…"] },
    ui: { chrome: { impressum: "Legal notice" } },
  },
},
```

The first language is the default at `/`. Other languages use `/<lang>`. Each page sets its document language, canonical URL, and `hreflang` alternates, including `x-default`. The language switch keeps the current section. Below 480 px it appears in the menu.

`i18n.<lang>` merges objects by key and replaces arrays and strings. Copy resolves in this order, with later values taking precedence:

1. Language defaults in `config/ui.js` and `server/pages.js`.
2. The letter configuration.
3. `i18n.<lang>`, including its `ui` block.
4. Published admin overrides.

Publication content is localized. Layout and appearance are shared across languages. Legacy `copy:` values and template IDs migrate into the first publication. Later edits publish as complete revisions.

The page sends a non-default language through `X-Lang` or `?lang=`. `/api/boot` and public errors follow it; unknown languages use the default. For rich content, `content.jsx` can export an object such as `en = { LetterArticle, FaqContent }` for each additional language.

### Recipient languages

Signatures, meeting registrations, and deletion requests store a normalized `lang`. `NULL` means the default language. Email uses that person's language for text, dates, footer, and links. Confirmation, deletion, and meeting links carry `?lang=<lang>` so the result page can retain its language after a row is removed.

Settings pages use `/<lang>/abmelden/<token>` and invitation pages use `/<lang>/i/<code>`. Invitation email uses the inviter's language; the invitee signs in the language of the page they opened. `/api/termin.ics?lang=<lang>` localizes calendar output. Default-language URLs keep their existing form.

Define localized templates under `i18n.<lang>.email.templates.<slug>`. Partial templates inherit other fields from the default. Setup stores them as `<slug>.<lang>`. Missing variants use the default template with the recipient language's footer and meeting text.

The German campaign forms allow a template and subject for each additional language. A missing template uses the default template. A missing subject uses the language template's subject if available, then the default subject. Campaign overrides are stored in `campaigns.i18n` as `{"<lang>": {"templateId", "subject"}}`.

When multilingual support is disabled, `languages` and `i18n` are ignored and the legacy German UI defaults apply.

## Runtime settings

Open `/<ADMIN_PATH>` to publish content, layouts, appearance, metadata, CSS, and email templates. Changes stay in a browser draft until publication. The server stores no drafts.

The admin also manages campaigns, signature goals, email delivery, optional statistics, and enabled meeting settings. Goals start from `hero.milestones`, then live in `app_settings` and appear through `/api/stats`. See [publishing and email administration](publishing.md) for approval and recovery behavior.

## Environment variables

| Variable                  | Required                        | Default                                | Description                                                                                                                                                                                         |
| ------------------------- | ------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LETTER_CONFIG`           | No                              | `example`                              | Letter directory under `config/letters/`.                                                                                                                                                           |
| `DATABASE_PATH`           | No                              | `./data/diaetendeckel.db`              | Encrypted SQLite file path.                                                                                                                                                                         |
| `DATABASE_ENCRYPTION_KEY` | Yes                             | -                                      | SQLCipher passphrase. Startup requires it.                                                                                                                                                          |
| `HONKER_EXTENSION_PATH`   | No                              | platform default                       | Honker SQLite extension path, `libhonker_ext.dylib` or `libhonker_ext.so`.                                                                                                                          |
| `SOURCE_DATABASE_URL`     | Migration only                  | -                                      | Source Postgres connection string for `db:migrate`.                                                                                                                                                 |
| `PORT`                    | No                              | `3000`                                 | HTTP server port.                                                                                                                                                                                   |
| `BASE_URL`                | No                              | `http://localhost:3000`                | Public URL (used in verification emails)                                                                                                                                                            |
| `NODE_ENV`                | No                              | `development`                          | `production` enables CSP headers + asset minification                                                                                                                                               |
| `ADMIN_PATH`              | Yes                             | -                                      | Secret single-segment admin path, without leading or trailing slashes. Use `my-secret-panel`, not `/my-secret-panel`.                                                                               |
| `ADMIN_PASSWORD`          | Yes                             | -                                      | Admin password.                                                                                                                                                                                     |
| `ADMIN_JWT_SECRET`        | Yes                             | -                                      | Admin signing secret, at least 32 characters. Production rejects a value equal to `API_TOKEN_SECRET`.                                                                                               |
| `API_TOKEN_SECRET`        | Yes (prod)                      | -                                      | Public API signing secret. Must differ from `ADMIN_JWT_SECRET` in production.                                                                                                                       |
| `REQUIRE_API_TOKEN`       | No                              | `true`                                 | Require a session token from `/api/session` for public reads. Set `false` to disable.                                                                                                               |
| `ALLOWED_ORIGINS`         | No                              | `BASE_URL`                             | Comma-separated CORS origins. Responses to unlisted origins use `BASE_URL`.                                                                                                                         |
| `TRUST_PROXY`             | No                              | `false`                                | Read the client IP from `X-Forwarded-For`. Enable behind a trusted reverse proxy. Production warns when unset.                                                                                      |
| `DATABASE_JOURNAL_MODE`   | No                              | `WAL`                                  | SQLite journal mode. Production and development Compose use WAL. The SQLCipher adapter queues operations and complete transactions across connections to the same database file within the process. |
| `GIT_COMMIT`              | No                              | -                                      | Commit shown at `/api/version`. Falls back to `COMMIT_SHA`, `SOURCE_COMMIT`, `GIT_SHA`, `SOURCE_VERSION`, and Railway, Render, or Vercel commit variables.                                          |
| `EMAIL_PROVIDER`          | No                              | `email.provider` (config)              | Initial provider, `resend` or `smtp`. A database-managed profile replaces the complete deployment profile.                                                                                          |
| `EMAIL_FROM`              | No                              | `email.from` (config)                  | Verified sender for either provider. Alias of `RESEND_FROM`.                                                                                                                                        |
| `RESEND_API_KEY`          | Yes when provider=resend (prod) | -                                      | Resend sending key.                                                                                                                                                                                 |
| `RESEND_FROM`             | No                              | `email.from` (config)                  | Verified sender. Alias of `EMAIL_FROM`.                                                                                                                                                             |
| `SMTP_HOST`               | Yes when provider=smtp (prod)   | `email.smtp.host` (config)             | SMTP hostname.                                                                                                                                                                                      |
| `SMTP_PORT`               | No                              | `email.smtp.port` or `587`             | SMTP port. Use 465 for implicit TLS or 587 for required STARTTLS.                                                                                                                                   |
| `SMTP_SECURE`             | No                              | `email.smtp.secure` or `false`         | Use `true` for implicit TLS or `false` for required STARTTLS.                                                                                                                                       |
| `SMTP_USER`               | No                              | -                                      | SMTP login. Connections require authentication and encryption.                                                                                                                                      |
| `SMTP_PASS`               | No                              | -                                      | SMTP password or app password.                                                                                                                                                                      |
| `EMAIL_MESSAGE_DELAY_MS`  | No                              | `email.pacing.messageDelayMs` or `550` | Milliseconds between individual sends, including Zoom link mail.                                                                                                                                    |
| `EMAIL_BATCH_DELAY_MS`    | No                              | `email.pacing.batchDelayMs` or `1000`  | Milliseconds between batches of 100 emails for campaigns and reminders.                                                                                                                             |
| `BACKUP_ENCRYPTION_KEY`   | Yes (prod)                      | `DATABASE_ENCRYPTION_KEY`              | Backup encryption key. Required in production. Development falls back to the database key.                                                                                                          |
| `BACKUP_DIR`              | No                              | `/app/backups`                         | Backup directory.                                                                                                                                                                                   |
| `BACKUP_KEEP`             | No                              | `privacy.backupRetentionHours` (48)    | Backup retention in hours. Overrides the value quoted in the privacy policy and warns if they differ. Cannot exceed `privacy.erasureLogDays * 24`.                                                  |
| `BACKUP_GZIP`             | No                              | `true`                                 | Compress encrypted snapshots with gzip.                                                                                                                                                             |

Use [`.env.example`](../.env.example) as the local template.

## Email profiles

The initial deployment profile uses `EMAIL_PROVIDER`, `EMAIL_FROM` or `RESEND_FROM`, and the provider credentials. Empty environment values are ignored. An administrator can import that profile into database management, then save and test a complete replacement. Environment fields do not supplement a database-managed profile.

Generic SMTP, mailbox.org, and Resend are supported. SMTP always requires certificate-validated TLS, including in development. Port 465 uses implicit TLS; port 587 requires STARTTLS. Use a trusted TLS mail catcher or the local test fixtures. Saved credentials never appear in settings or previews. Generic SMTP asks for the operator and processing region because the protocol cannot establish them.

Provider acceptance, confirmed receipt, activation, and readiness are separate states. Failed credentials can pause delivery while admin access remains available. Restoring a database invalidates validation. Activation updates the protected email-processing facts in the privacy disclosure.

Transactional and campaign mail share persisted account cooldowns. `EMAIL_MESSAGE_DELAY_MS` and `EMAIL_BATCH_DELAY_MS` still control worker pacing. Quota deferrals do not consume permanent-error attempts. See [email setup](publishing.md#configure-email-delivery) for replacement, DNS checks, and reconciliation.
