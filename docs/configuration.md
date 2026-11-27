# Configuration

Each letter has a directory under `config/letters/<name>/`. Its `index.js` defines the initial configuration. `content.jsx` contains the letter and FAQ. Environment variables supply secrets and server settings.

An optional `letter.css` in that directory is bundled with public pages. Scope its rules to `[data-letter="<name>"]`, the attribute on `<html>`. The admin interface does not load it.

After the first publication, the database supplies published content and templates. Changing deployment defaults does not replace a publication. See [publishing](publishing.md) for runtime editing.

## Letter config

| Key                     | Purpose                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `brand`                 | Name, wordmark, language, and locale.                                                                                                 |
| `theme`                 | Colors, fonts, spacing, borders, and shadows. See below.                                                                              |
| `meta`                  | Page title, descriptions, canonical URL, social metadata, favicon, JSON-LD `schemaAbout`, and optional external `analytics` settings. |
| `privacy`               | Retention periods and link lifetimes. The server enforces them and the privacy policy quotes them.                                    |
| `hero`                  | Optional kicker, headline lines, optional description and artwork, buttons, counter labels, and initial `milestones`.                 |
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
| `previousDefaults`      | Earlier texts of this file by copy path, for a site that started on an earlier version. See [changed defaults](#changed-defaults).    |

`legal.privacyHtml` replaces the default privacy policy with your own, as HTML. The server completes it as it completes a policy a team wrote in the admin. It adds the paragraphs on blocked addresses, the admin log, and first signers added by hand, and the statements about the optional fields of the form, as far as your policy lacks them. A new site stores your policy with these additions. A site whose team has not edited the policy follows the config when you change the policy or the form. The additions are German or English, as the next paragraph says, so state `legal.privacyLanguage` with a policy in another language than the letter's.

`legal.privacyLanguage` states the language of the privacy policy, `"de"` or `"en"`. The server writes in that language when it has to add text to a policy the team edited. Without the key, the server decides once: German for a site that starts on the default policy, which is German for every language. Set the key when the team replaces the default with a policy in another language. In a letter with several languages, set it per language under `i18n.<lang>.legal`. See [publishing](publishing.md#storage-and-application-controls).

### Changed defaults

A site stores a value for every text of its letter, including the ones nobody edited, so the admin can edit them. A stored text that still is what was its default follows the default when you change it in the config, and when a new version of the platform changes it. A text the team edited stays. The server records each default at every start to tell the two apart. A start that changes a text publishes a new revision and adds an entry to the admin log. See [publishing](publishing.md#storage-and-application-controls).

A database that last ran a version without that record cannot tell them apart. For it, a stored text counts as an old default in two cases:

- The letter lists it under `previousDefaults`, by copy path: `previousDefaults: { "sign.fields.occupation.label": ["Occupation"] }`. In a letter with several languages, `i18n.<lang>.previousDefaults` lists them for that language.
- It is an interface text (`ui.…`) and equals the platform's wording for it, the current one or an earlier one from `PREVIOUS_UI_DEFAULTS` in `config/ui.js`. That is what the site showed before the letter set its own text. For a letter with one language, that was the German wording, because earlier versions gave every such letter the German table. For a letter with several languages, the German wording counts too, because the letter may have had one language when the text was stored.

Such a text moves to the current default once, at the first start on this version. After that the record exists, and a text the team sets to an earlier wording stays.

### Theme and form fields

`theme.colors` becomes CSS variables. Optional colors include `onAkzent`, `ctaBg`, `ctaFg`, `goalFill`, `ctaHoverBg`, `ctaHoverFg`, `heroBg`, and `statBg`. The theme also supplies email and generated-image styling.

`theme.fonts` selects `display` and `body` fonts. `theme.style` accepts `shadowOffset`, `radius`, and `borderWidth`, plus `cardRadius`, `buttonRadius`, `headlineMaxWidth`, `inputRadius`, `checkRadius`, `bannerRadius`, and `bannerPadBottom`. Cards default to 16 px corners. Buttons and inputs default to 10 px. Set radius values to `"0"` for square corners. `shadowOffset: "none"` removes offset shadows, including on mail-link pages. `shadow: "soft"` selects blurred shadows.

`sign.fields` controls labels and placeholders for `kreisverband` and `occupation`. The regional field also accepts `options` for a server-validated fixed list, `selectPlaceholder`, `pluralLabel`, `noneLabel`, and `rowPrefix`.

### Feature flags

Feature flags are `kreisverbandField`, `occupationField`, `germanyMap`, `stateResolution`, `zoomEvent`, `inviteLinks`, and `multiLanguage`. The map and state resolver currently use Germany.

These flags change what the public list shows:

| Flag                       | Default | Effect                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicSignerDetails`      | off     | The form replaces the public-name checkbox with three choices under `ui.signForm.visibilityLegend`: keep the signature private, show the name only, or show the name with role and organisation (`sign.publicDetailsLabel`). Role and organisation appear, and are counted in the list's filters, only for people who chose the third. Without the flag they are published as counts only, for everyone with a public name. |
| `publicFirstSignerDetails` | off     | Shows role and organisation next to the names of first signers who agreed, even without `publicSignerDetails`. They can change that on their settings page.                                                                                                                                                                                                                                     |
| `faq`                      | on      | `false` removes the FAQ section. Remove its entry from `nav` as well.                                                                                                                                                                                                                                                                              |

With `publicSignerDetails`, the form offers three choices: keep the signature private, show only the name, or show the name with details. The region then counts as one of the details. It appears in the list, its search, and the export only for people who chose the third option, so name the region in `sign.publicDetailsLabel` when the regional field is on. The public counts per role, organisation, region, and state cover the same people and nobody else, because a count of 1 names its one signer. Without the flag, the region appears with every public name, as the single checkbox says, and the counts cover every public name.

### Hero kicker, description, and artwork

`hero` accepts three optional parts. Leave a key out and the hero looks as it does without it.

| Key           | Shows                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `kicker`      | A short line above the headline, in the accent colour.                                                                          |
| `description` | A sentence or two below the headline, in the light display font.                                                                |
| `artwork`     | An image with `src`, `alt`, `width`, and `height`. Wider than 900 px it stands beside the text, below 900 px after the buttons. |

Put the image in `public/` as PNG, JPEG, WebP, AVIF, or GIF. SVG is not served, see [operations](operations.md#images-in-public). Set `width` and `height` to the image's pixel size: the page reserves the space from them, so nothing moves when the image loads.

The example letter shows `public/example-artwork.webp`, a placeholder drawn in its theme colours. `bun scripts/generate-artwork.js` draws it again, for example after you change `theme.colors`. Replace it with your own image before you publish.

### Role and organisation

A letter can ask signers for their organisation and their role, and let them choose whether both appear next to their name.

1. Set `features.occupationField: true` and relabel `sign.fields.occupation`, for example as "Organisation".
2. Define `sign.fields.signerFunction` with `label`, `optionalLabel`, `placeholder`, `filterLabel`, and `emptyLabel`. The list then gets a filter, labelled `filterLabel`, that counts signers by role.
3. To publish them, set `features.publicSignerDetails: true` and `sign.publicDetailsLabel`, the text of the third visibility choice. See [feature flags](#feature-flags).

Both fields are stored, edited in the admin, and exported separately. With either details flag on, a row in the public list shows role and organisation when the signer agreed to it. A row without them shows the region only when `features.kreisverbandField` is on and, with `publicSignerDetails`, only for signers who chose the details. Without either details flag, every row shows the region line, or `noneLabel` for a signer who gave no region.

Without `features.multiLanguage`, interface copy starts from the German defaults in `config/ui.js`. A letter in another language sets the copy these features show in its own `ui` block, as the example letter does:

```js
ui: {
  list: {
    filterOccupations: "Organisations",
    emptyOccupations: "No organisations given yet.",
    firstSigner: "First signatory",
  },
  signForm: {
    visibilityLegend: "What should appear in the public list?",
    visibilityPrivate: "Keep my signature private",
    visibilityName: "Show only my name",
  },
  settings: {
    occupationLabel: "Organisation",
    errOccupationLong: "Please shorten the organisation to 160 characters or fewer.",
  },
},
```

Two more groups of copy show on any letter, whatever its features, and are German until the letter sets them. A sign-up made while mail is delayed shows `ui.signForm.emailDelayed` on the form and `ui.emailModal.delayedTitle`, `delayedSent`, and `delayedHint` in the modal. `delayedHint` takes `{hours}` and `{waitHours}`, the two periods from `privacy`. A signing pause shows `ui.signForm.pausedTitle` and `pausedMessage`. The example letter sets all six in English.

### First signers

Signers the team marks as first signers in the admin carry the label `ui.list.firstSigner` in every view of the list. Mark them, and give them a position, under **Unterschriften** with **Bearbeiten**, or in the **Erstunterzeichner\*innen** card below the list. The card also adds people by hand or from a CSV file. In the default view, signers with a position come first, then marked first signers without one, then everyone else. The privacy policy states which details are published.

`bun run db:seed` adds four marked first signers with positions, roles, and organisations, so a local copy of the example letter shows the label and the admin card has entries.

### Invitation statistics

Invitation statistics use `statsMode` with `ranges` as the default, or `threshold` or `exact`. Configure `statsRanges` or `statsThreshold` for the chosen mode. Invitation copy accepts `{firstName}`, `{title}`, and `{url}`.

## The example letter

`config/letters/example/` is in English and turns on the features above, so a new letter starts from a page that shows them:

- `hero.kicker`, `hero.description`, and the placeholder `hero.artwork`.
- The organisation and role fields (`features.occupationField`, `sign.fields.signerFunction`), with the visibility choice (`features.publicSignerDetails`) and the **Roles** filter.
- First signers, from `bun run db:seed`.

To turn a feature off in your copy, delete its keys or set its flag to `false`. The region field, the Germany map, and the meeting stay off in the example.

## Languages

Without `features.multiLanguage`, the letter has one language, `brand.lang`. Its interface texts come from that language's table in `config/ui.js`: English for `"en"`, German for `"de"` and for any language without a table. With the flag enabled, declare the languages and their overrides:

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

The page sends a non-default language through `X-Lang` or `?lang=`. `/api/boot` and public errors follow it. Unknown languages use the default. For rich content, `content.jsx` can export an object such as `en = { LetterArticle, FaqContent }` for each additional language.

### Recipient languages

Signatures, meeting registrations, and deletion requests store a normalized `lang`. `NULL` means the default language. Email uses that person's language for text, dates, footer, and links. Confirmation, deletion, and meeting links carry `?lang=<lang>` so the result page can retain its language after a row is removed.

Settings pages use `/<lang>/abmelden/<token>` and invitation pages use `/<lang>/i/<code>`. Invitation email uses the inviter's language. The invitee signs in the language of the page they opened. `/api/termin.ics?lang=<lang>` localizes calendar output. Default-language URLs keep their existing form.

Define localized templates under `i18n.<lang>.email.templates.<slug>`. Partial templates inherit other fields from the default. Setup stores them as `<slug>.<lang>`. Missing variants use the default template with the recipient language's footer and meeting text.

The German campaign forms allow a template and subject for each additional language. A missing template uses the default template. A missing subject uses the language template's subject if available, then the default subject. Campaign overrides are stored in `campaigns.i18n` as `{"<lang>": {"templateId", "subject"}}`.

When multilingual support is disabled, `languages` and `i18n` are ignored.

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
| `TRUST_PROXY`             | No                              | `false`                                | Read the client IP from the last `X-Forwarded-For` entry. Enable behind a trusted reverse proxy. Production warns when unset. See [security](security.md#requests-and-authentication).              |
| `HEALTH_TOKEN`            | No                              | unset                                  | Bearer token that adds numbers to `/api/health/operations`. At least 16 characters, and not the admin password. See [operations](operations.md#monitoring).                                         |
| `SIGNING_PAUSED`          | No                              | unset                                  | `1` pauses signing. See [operations](operations.md#pausing-sign-ups).                                                                                                                               |
| `DOMAIN`                  | With the Caddy proxy            | -                                      | Domain Caddy serves and gets a certificate for. See [operations](operations.md#https-with-caddy).                                                                                                   |
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

Generic SMTP, mailbox.org, and Resend are supported. SMTP always requires certificate-validated TLS, including in development. Port 465 uses implicit TLS. Port 587 requires STARTTLS. Use a trusted TLS mail catcher or the local test fixtures. Saved credentials never appear in settings or previews. Generic SMTP asks for the operator and processing region because the protocol cannot establish them.

Provider acceptance, confirmed receipt, activation, and readiness are separate states. Failed credentials can pause delivery while admin access remains available. Restoring a database invalidates validation. Activation updates the protected email-processing facts in the privacy disclosure.

Transactional and campaign mail share persisted account cooldowns. `EMAIL_MESSAGE_DELAY_MS` and `EMAIL_BATCH_DELAY_MS` still control worker pacing. Quota deferrals do not consume permanent-error attempts. See [email setup](publishing.md#configure-email-delivery) for replacement, DNS checks, and reconciliation.
