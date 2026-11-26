# Publishing and email administration

The German admin interface edits website content and email templates, manages recipients and scheduled mail, and configures email delivery and statistics. It declares German as its document language, regardless of the public letter's language.

## Edit and publish

Open Website to edit the layout, public copy, design, metadata, or CSS. Open Vorlagen to edit email templates. Both areas share one draft. Publishing saves the complete revision in SQLCipher and makes it available on the next public page load. Content changes need no rebuild or restart. New application features still require deployment.

The publication button names the affected areas. "Änderungen prüfen" lists the changes by area, language, template, and field. Template changes also affect messages already scheduled, because delivery uses the template published at send time.

The browser keeps the draft and undo history across admin navigation. The URL fragment retains the current admin area, including settings shortcuts. Website remembers its editor tab. Vorlagen remembers its template and language. Use "Rückgängig" to undo a local change or "Entwurf verwerfen" to return to the current publication. Leaving a changed page requires confirmation. Drafts stay in the browser until publication. The server does not store them.

Invalid design values and missing required template links or placeholders block publication. The fields show German correction guidance. The server applies the same validation rules.

### Recover a draft or publication

"Weitere Aktionen" lets you save a JSON draft file, restore one, or load the preceding publication as a draft. Loading a previous version does not publish it.

Imports are limited to 4 MB. The server validates the file and checks that referenced images still exist in this installation. The comparison includes the imported file, the browser draft, and the current publication. Changes to separate fields merge automatically. Conflicting values require a choice. Templates and FAQ questions merge by stable ID and field. FAQ order is reviewed separately. Older drafts without a baseline require review of each difference.

The comparison shows readable values, including formatted text, headline styles, lists, default values, and resolved automatic metadata. Accepting the result changes only the local draft and can be undone. Publishing remains a separate action.

A draft carries the revision and the id of the publication it was made from. Both have to be the current publication's. The id is made from the revision, the time of publication, and the document. After a backup is restored, the next publication takes a revision number that a discarded publication had, and a draft made from the discarded one is stale all the same. A draft that the browser saved before ids existed counts as stale once and goes through the comparison.

A stale publication request returns HTTP 409. The recovery panel retains the draft and offers comparison with the current revision. Other failures distinguish rejected content, expired authentication, and an unconfirmed server result. The panel receives focus and offers draft backup and the relevant recovery action. "Weiter bearbeiten" returns focus to the editor. On mobile, the publication controls bring recovery into view. The change-review disclosure closes when publication starts so it cannot cover recovery controls.

Browser drafts are not database backups. Preserve the database and its encryption keys.

## Layout, images, and previews

Puck 0.24.0 edits the layout. The header, main hero, and legal footer have fixed positions. Functional sections occur once and cannot be deleted, duplicated, or renamed. Additional text, image, and call-to-action sections can be added and reordered. The server enforces these rules too. Blocks and FAQ questions have stable IDs. The Puck layout defines section order. Section names appear in German.

The editor canvas uses sample data and validated theme values. It does not run custom publication CSS. The full preview runs in an iframe with an opaque origin, blocked network access and forms, simulated API responses, and no analytics. It supports languages, mobile/tablet/desktop widths, and campaign, success, confirmation, and error states. Changing the draft, language, or page state hides an obsolete preview. Failures keep the draft and offer retry with German guidance. Technical details remain expandable.

CodeMirror supplies CSS syntax, completion, and diagnostics. The shared client/server policy rejects imports and resources outside approved uploaded assets. Custom CSS affects the full preview and public pages, not admin controls. Deployment `letter.css` also stays outside the admin interface.

Image uploads accept PNG, JPEG, and WebP up to 8 MB and 16 megapixels, with dimensions between 16 and 8000 pixels. Normalization rotates the image, fits it within 2400 pixels, removes metadata, and stores PNG bytes. Content hashes give images immutable URLs. The current and preceding publications retain their referenced images. Unreferenced uploads have a 24-hour grace period, limited to 64 images and 32 MiB. Older draft files may require images to be uploaded again. The serving cache holds at most 64 images and 16 MiB and checks current access before returning cached bytes.

Metadata defaults to the current branding and campaign or success copy. Administrators can override the title, search description, social description, image text, and image, then reset them to automatic values. Satori and Sharp generate localized 1200 by 630 pixel social images.

Previews embed generated social images without storing them. Publication commits generated images with the document. Maintenance removes images that no retained publication or recent upload needs.

## Email templates and languages

For a system message, choose "Sprache der Systemnachricht". Missing translations show the effective default-language subject and preview. Creating a translation copies the default message into the local draft. Translate its subject and body before publishing. The copied message retains required links and placeholders.

Newsletter translations are separate template entries selected in the sending form. Broadcasts offer only newsletter templates. The server rejects confirmation, deletion, invitation, and meeting templates for broadcasts.

Removing a newsletter template retires it from the published catalog. Finished campaigns retain its historical database identity. A scheduled or sending campaign that still uses it blocks removal with a validation message. New templates receive IDs above the historical catalog, so they cannot take over an old campaign's template.

Insertion controls add personal values and links at the cursor. Missing required parts can be appended individually without replacing the existing text. Resetting the whole body is a separate action and can be undone. Email previews use sample recipients, links, and expiry times. Changing the language or content hides preview results and errors belonging to the old request.

## Compose and schedule mail

Versand sends to an audience. Unterzeichner sends to a saved selection. Both composers retain their template, subject, language variants, and schedule in browser storage. A missing template remains visible as unavailable. Sending, scheduling, and testing stay disabled until a replacement is chosen. A template change preserves written subjects. "Vorlagenbetreff übernehmen" replaces the subject explicitly.

New schedules default to tomorrow at 10:00 in the browser's timezone. Dates use TT.MM.JJJJ and times use HH:MM on a 24-hour clock. The timezone appears beside the inputs. Past times are rejected. "Versand einplanen" creates a scheduled job. "Jetzt senden" requests immediate delivery.

Before either action, the admin reloads the audience and subject examples. A failed read blocks submission. Approval shows when the audience was checked, recipient counts by language, default-language fallback, example subjects, and delivery time. Long approval text scrolls separately from its actions and supports keyboard scrolling.

Recipient counts can change before delivery. A scheduled campaign uses the audience and published template available when the worker sends it. Explicit subject overrides remain saved. Inherited template subjects can change. Approval explains both effects.

Each creation request has a `request_key`. The browser saves it before submission and reuses it after a lost response or reload. An identical replay returns the existing campaign. Reusing the key for different content returns 409. Reset the draft to create an intentional new copy. API clients must set `send_now: true` for immediate delivery.

Canceling a scheduled campaign requires confirmation of its identity and send time. The canceled record and request identity remain in history. Retrying an aborted campaign requires a fresh approval showing remaining recipients and current templates. Logged provider acceptances are excluded. Dynamic audiences can include new eligible recipients. Canceling or failing the review creates no retry request.

### Select recipients

The signer list keeps search visible and puts region and date controls under "Weitere Filter". Active filters remain visible when those controls close. Date ranges include both complete local calendar days. A reversed range marks both fields invalid and pauses result and filter-comparison requests until corrected. It retains the existing selection.

Adding all matches extends the selection across filters. "Ausgewählte Empfänger prüfen" lists the complete selection, reports how many people are outside the active filter, and allows individual removal. "Nachricht verfassen" focuses the composer. Browser storage retains IDs, not names or email addresses.

The list ignores superseded search responses and disables selection of results while loading. Mobile cards retain identity and selection. Desktop identity columns remain visible during horizontal scrolling. Failed reads show retry controls and mark any retained data as stale.

### Inspect history

Opening Versand refreshes campaign history. It also has a manual refresh action. "Versanddetails & Empfänger" shows campaign ID, creation and completion times, provider-accepted counts, and saved language choices.

Selection campaigns show their saved audience in pages, limited to currently eligible recipients. Deleted or unsubscribed people stay hidden. Dynamic campaigns resolve their audience at send time. Neither saved template IDs nor provider acceptance prove what arrived in a recipient's inbox. Templates may have changed since delivery.

## Configure email delivery

Einstellungen offers an existing-mailbox route and a delivery-service route. It supports generic SMTP, mailbox.org, and Resend. Deployment profiles remain read-only until an administrator chooses to manage them in the database. That action imports the complete profile and credentials into SQLCipher without activating delivery. Empty environment values are ignored. Database-managed profiles do not merge connection fields from the environment.

To replace a profile:

1. Save the complete replacement, including fresh credentials if the provider, server, or account changed.
2. Check the connection and send a setup test.
3. Confirm receipt of that specific test in the named mailbox, including its spam folder.
4. Activate the profile and release automatic delivery.

Testing and activation remain collapsed until their prerequisites are met, but their explanations can be opened earlier. Provider acceptance, confirmed receipt, activation, and delivery readiness are separate states. Editing a replacement preserves the active transport. Saved secrets never appear in settings or previews.

After a revision conflict, reload the saved profile for comparison. Local inputs and newly entered credentials stay in the form. The comparison excludes secrets. Acknowledging it enables saving. Another successful test is required before activation.

A setup test stores its ID, recipient, acceptance time, and profile revision. The receipt panel shows these after reload. Receipt confirmation includes the displayed test ID and rejects a superseded test. Older records without a complete identity require a new test. Action feedback appears beside the initiating control and restores focus after completion.

Activation releases eligible queued messages, due campaigns, and automatic Zoom mail. The adjacent review shows queued and stopped counts. Aborted campaigns and Zoom mail stay stopped until separately released. Authentication, encryption, sender authorization, and configuration failures can pause sending. Admin access, unsubscribe, and erasure remain available. Restoring a database requires revalidation, including for deployment-managed profiles.

### SMTP and mailbox.org

SMTP requires certificate-validated encryption, including in development. Port 465 uses implicit TLS. Port 587 requires STARTTLS. Resend supports sending-only API keys.

For mailbox.org, use `smtp.mailbox.org`. Enter the main login address separately from the registered sender alias. Create an app password, complete the account's custom-domain check, and register the alias. Trial accounts may restrict external delivery, so test receipt outside mailbox.org.

The admin generates ownership TXT, SPF, four DKIM selector, and DMARC instructions and checks published records. Merge SPF into the existing single policy. Preserve an existing DMARC policy. Documented legacy DKIM TXT records are accepted. The campaign ownership TXT does not replace mailbox.org's account verification. Published DNS records do not prove message signing or inbox delivery. Setup does not change MX records or incoming mail. OAuth and automatic DNS writes are not supported.

### Delivery failures

Transactional and campaign mail share account pacing and persisted quota cooldowns. Workers wait through normal account spacing without holding a database transaction. Longer cooldowns defer durable work. Quota deferrals do not consume permanent-error attempts. Neither does a transactional mail that failed for the moment: it is tried again until its queued job expires. Campaign delivery expires within the deduplication-retention window, including after deferrals. Transactional workers check token expiry and row existence before rendering. Each logical message has a stable identity and credentials across retries.

Recorded attempts remain bound to their provider and profile revision across activation and restart. Retired credentials remain only while unresolved attempts need them. An uncertain SMTP result leaves that recipient pending for reconciliation while the worker continues with other eligible recipients. Check the provider log before recording acceptance or authorizing retry. Diagnostics show categories, protocol codes, and correlation IDs without raw provider errors that could contain recipient details.

## Meetings and automatic email

Meeting settings load before saving becomes available. Saving requires the loaded revision. A concurrent edit returns 409 and preserves the inputs for comparison. Choosing saved or local values prepares the form. Saving is still a separate action. Changing an unrelated field preserves the original event timestamp.

A change to the meeting date, mailing times, or Zoom link requires a delivery review. It reloads mailing state, recipient/language counts, and published system templates. It identifies open sending windows, missing links, and language fallback. A date change resets delivery tracking, so previous recipients may receive the messages again. Canceling preserves the inputs and restores focus. A failed review blocks saving.

Date changes and explicit resets create a new event generation. Claims, progress, and delivery records belong to that generation. An old worker's completion cannot mark the new event as delivered. Registration confirmation and immediate join-link mail use durable jobs, including when scheduled mail has already run.

Aborted automatic Zoom mail stays stopped after email repair. Its panel explains how to test the affected message and copy support details. The technical operator must inspect delivery tracking before recovering missing messages. Changing unrelated meeting fields does not restart the mailing.

## Statistics

Built-in statistics start disabled and cannot run alongside deployment-configured external analytics. Analytik uses its public asynchronous storage interface on a dedicated SQLCipher connection. It needs no browser tracker, separate service, or dashboard.

Only eligible public GET requests count. Private links, admin pages, previews, APIs, assets, prefetches, recognized bots, and requests with DNT or GPC are excluded. Stored page paths omit queries and fragments. Referrers contain domains only. Raw IPs and browser identifiers are used temporarily to derive monthly pseudonyms and are not stored. Location and screen collection are disabled. Records expire after 30 days. Counts are approximate and are not linked to signers. The privacy disclosure makes no promise of anonymity or exemption from consent requirements.

Reports cover 30 UTC dates, including the partial current day. The heading, chart, and table use the same UTC dates. The chart initially selects the day with the most views. Points and the day slider reveal daily counts. The slider supports arrow keys. The table contains all values. Save failures distinguish rejected settings, revision conflicts, and unconfirmed results. Reloading checks the saved mode without discarding a changed selection. Analytics writes do not invalidate public caches or block page delivery.

## Storage and application controls

SQLCipher stores publications, complete templates, source images, email profiles, attempts, and limiter state. Credentials stay outside public publication data. Publications use schema version 2. Version 1 FAQ markup migrates to ordered records. Puck upgrades require an explicit application migration.

Startup loads a complete publication and template snapshot before starting the server or workers. Visitor rendering and template selection make no copy/template SQL queries. Preparation runs before the publication transaction on a dedicated connection. Publishing serializes revision checks, persists the document and templates, then replaces the in-memory snapshot. A failure leaves the preceding revision visible.

Starting the server adapts the stored publication to the current deployment configuration. Added languages and fields receive defaults. Removed fields, languages, and the disabled meeting or FAQ section stay in an archive within the document and return when the configuration supports them again. Enabling meetings adds the section when needed. These changes keep the revision. The server serves the adapted publication and leaves the stored one as it was published. The archive is stored with the next publication. Submitted edits still undergo strict validation.

A start also brings stored copy in line with the letter. It records what it has done in `app_settings` under `publication:stored-copy`, so it makes each change once. Starting again changes nothing. The record goes with a publication. The site keeps one for the current publication and one for the publication before it when a start has changed copy in between. Development versions between two releases kept the record in other forms, one of them under `publication:copy-defaults`. A start reads those and stores today's form.

- A stored text that still is its recorded default follows a changed default. An edited text stays. See [changed defaults](configuration.md#changed-defaults).
- An edited privacy policy follows the form. When the form asks for other optional fields, or signers start or stop choosing their details, the start updates what the default's own sentences say about them: the optional fields stored, a region shown with a public name, the counts per organisation and role, and the role and organisation shown with consent. A sentence the team rewrote stays as it is. That includes a sentence of the default into which the team put words of its own, for example "sowie optional Organisation nach Prüfung durch unser Team gespeichert": on a site from before the record, the start replaces only a clause that a default wrote word for word. When such a sentence does not name the fields the form asks for now, the start leaves it, adds the statement at the end, and the admin log asks the team to check the sentence. A new statement that has no place left in the default's sentences goes into one paragraph at the end. A statement the policy already makes in the default's wording is not added. A statement that was added once is not added again after the team has put it in its own words. Sections about other features, such as the map service that resolves a region's state, are not added to an edited policy.
- An edited policy that would be longer than 120,000 characters with what the start has to add stays as it is. The admin log says so once. The team then shortens the policy and adds the statement itself, because the start does not try again.
- Two sentences of earlier defaults about the counts per occupation are taken out wherever they stand, at every start: the one of the first release ("Berufsangaben dieser Unterschriften werden nur als Anzahl je Beruf veröffentlicht"), and the one that says the counts cover every public name, unless the form still does that. This holds while the form asks for no occupation, and for a policy that an old draft brought the sentence back into. The statement that took the sentence's place is then made if the policy lacks it.
- A site that last ran a version without the record gets, once per language, the paragraphs on blocked addresses, the admin log, and first signers added by hand. A language the letter was without at that start gets them when it is back. The default's old newsletter sentence is replaced. A newsletter sentence the team wrote itself is left alone, and the app cannot tell what it says. Such a policy must state that campaign emails also go to people who subscribed later through the confirmation link in an email from the team, so add that sentence by hand.
- A stored text that its field no longer accepts never stops the start. A text becomes invalid when its default gains a placeholder. The text keeps its wording and gains the paragraph or sentence of the default that carries the placeholder. If the default is a single sentence, the default replaces the text.
- Size never stops a start and never changes a stored text. A formatted text may be 120,000 characters long, and a publication 2 MB. The length of a formatted text is counted as it is stored, where every link carries one attribute more than as it is typed. Both limits apply when someone publishes. A stored publication loads at any size, for example after the start added paragraphs to a policy in a publication that was just under 2 MB. The next publication from the admin then has to fit, so the team shortens a text first. A text from the letter's config that nobody edited is accepted at any length.

When a start changes a text the site already had, it stores the result as a new revision. The publication as it was stays in the database unchanged, as the preceding one. A browser draft from before then gets the stale-publication flow instead of overwriting the change. The admin log lists the changed texts under "Texte der Website beim Start des Servers angepasst". The server log counts the texts that follow a changed default and names every other changed text. Read the privacy policy after such an entry. An entry also appears when the default policy changed and the start could change nothing in an edited one. Where the default had to replace a text, the entry holds the whole text that was replaced.

"Vorherige Version laden" loads the preceding publication as the letter accepts it now. The server applies to it what a start would, going by the record of that publication: a privacy policy says what the form asks for today, and a text the letter no longer accepts is repaired. Publishing it again therefore cannot bring back a statement about a field the form no longer has. When the preceding publication differs from the current one only by what a start changed, the admin says that it matches the draft.

A statement the server once added is taken out in the words it was added in, also when text is added in another language by now. The record keeps those words.

The server adds text to an edited policy in that policy's language. It decides the language once per page language, when it first sees the policy, and keeps the decision in the record. A policy that is the platform's default, or still has a whole paragraph of it, is German, because the default is German for every language. A policy that the letter's config supplies as `legal.privacyHtml` is completed in the language decided for the config's text, and a stored policy that still is the letter's default takes that language again. Any other policy counts as written in the language of its page where a translation of the added text exists, which is English, and as German elsewhere. The words of the policy play no part. A site that starts on the default therefore keeps German for added text, also after the team rewrites the policy. Set `legal.privacyLanguage` to `"de"` or `"en"` in the letter's config when the decision is wrong, for example after the team replaced the default with an English policy. What the config states always holds.

Two server processes can share one database, and one can publish while the other starts. A start stores its result only if the publications and the record it read are still the stored ones. It checks that in the transaction that stores the result, and reads again when they have changed. A new revision is inserted, never written over an existing one.

Restoring a backup checks that the server can start with the backup's newest publication and leaves the publications as the backup has them. The next start adapts the newest, going by the record the backup holds.

HTML embeds escaped public configuration and theme values before React renders. `/api/boot` supplies live counts, meeting settings, and email readiness without copy. Public bundles exclude the admin editors.

Application-owned controls use Base UI for buttons, checkboxes, inputs, selectors, dialogs, tabs, menus, disclosures, formatting toggles, and the statistics slider. Multiline fields use Input with a textarea renderer. File and color pickers stay native. React Day Picker retains its calendar with Base UI day and navigation buttons. Puck, Tiptap, and CodeMirror keep their own interfaces. Mobile application actions have at least 44 px touch targets.

Navigation away from unsaved settings requires confirmation. Sign-out identifies settings that will be discarded. Expired authentication opens a Base UI login dialog without unmounting the editor or losing its local settings and credentials. Login never retries a failed action automatically. A crash screen offers a Base UI reload button. Only drafts already saved in browser storage survive a reload.

## Verify and restore

Run `bun run honker:build` before tests that need the Honker extension. Local SMTP fixtures require OpenSSL and permission to listen on loopback.

| Command                                    | Checks                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run verify:publishing`                | Publication policy, persistence, email setup, TLS, and statistics.                                                                                                                              |
| `bun scripts/verify-publishing.js`         | Disposable application fixture with authentication, publication, conflicts, invalid CSS, metadata, images, preview isolation, bundle separation, restart persistence, and visitor query checks. |
| `bun scripts/verify-publishing.js --serve` | The same checks, then leaves the synthetic fixture running for browser inspection. It has no working mail credentials.                                                                          |
| `bun run verify:delivery`                  | Real HTTP and Honker checks for queue outages, burst signup, replacement links, invite replay, consent, and erasure during sending. External providers are stubbed.                             |
| `bun run lint`                             | Undefined names in application code, scripts, and tests.                                                                                                                                        |
| `bun test --timeout 60000`                 | Full test suite, including SMTP and encrypted backup restoration.                                                                                                                               |

Stop the app before restoring. Restoration validates documents and asset hashes, checks table counts, reapplies erasures and opt-outs, and marks email validation stale. Startup rebuilds derived asset caches. Run one application instance. Development watches frontend source, configuration, templates, and server/database code. See [operations](operations.md) for backup and restore commands.
