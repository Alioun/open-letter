# Single-letter roadmap

Draft dated 8 November 2026. The features below are proposed work. Existing publishing and Base UI controls are documented separately.

An organizer should be able to launch a letter, review participation, moderate public signatures, and contact supporters through the admin interface.

## Agreed scope

- Each installation runs one letter. Multiple letters, campaign ownership, and shared audiences between campaigns are out of scope.
- Team accounts have no priority in this release.
- Add guided setup, participation reports, saved audiences, signature moderation, and configurable city and country maps.
- Use Base UI for supported, hand-built admin controls. Keep JSX and the existing CSS. The application now uses React 19.
- Keep Puck, Tiptap, and CodeMirror. Their own interfaces are outside the Base UI migration. App controls around them remain in scope.
- Preserve verified signatures, separate newsletter consent, private-name choices, unsubscribe, erasure, encrypted storage, and restoration protections.

Campaign closure, PDF handover, public updates, endorsements, and integrations remain separate proposals. They are not prerequisites for this scope.

## Existing behavior to build on

The [publishing workspace](publishing.md) already provides localized content, branding, previews, revision checks, draft recovery, email setup, and recipient review. New work extends those paths.

Several settings still come from deployment configuration. [config/letter.config.js](../config/letter.config.js) derives languages at module load. [config/publication.js](../config/publication.js) uses deployment feature flags when validating sections. A setup wizard alone cannot make those settings editable at runtime.

The current admin signer list in [server/db.js](../server/db.js) lists verified newsletter subscribers. Moderation needs a separate view of signatures, including people who declined newsletters.

The current map combines a Germany outline, fixed state markers, and Kreisverband-to-state resolution in [src/App.jsx](../src/App.jsx), [server/states.js](../server/states.js), and [server/nominatim.js](../server/nominatim.js). Nominatim queries restrict results to Germany. [config/region.js](../config/region.js) allows some field wording changes, but it does not define a general geography model.

[server/statistics.js](../server/statistics.js) records eligible page visits. It deliberately excludes private links and does not join analytics to signers. Personal invitations retain aggregate successful referrals without a permanent inviter-to-signer relationship.

## Guided launch setup

An organizer opens **Einrichtung**, completes a saved checklist, previews the result, and publishes the reviewed settings. The same checklist stays available after launch.

Use these setup steps:

1. Enter the organizer name, responsible organization, contact details, legal information, and retention settings.
2. Edit the letter, signature goal, branding, social preview, and signer display settings in the existing editors.
3. Choose supported languages, the default language, and optional area and occupation fields. Show which translations are ready.
4. Choose no map, a supplied map, or imported boundaries. Preview the map alongside the form.
5. Set up email through the existing provider, test, receipt-confirmation, and activation controls.
6. Review missing requirements, warnings, public previews, and the changes awaiting publication.

Each step distinguishes saved draft values, published values, and operational checks. Completing the checklist does not activate delivery or publish content.

Deployment facts remain clearly identified. Show the configured public URL, HTTPS and proxy status, backup status where observable, and instructions for unresolved deployment tasks. Editing a URL field cannot provision a domain or certificate. Never claim a backup is healthy merely because a directory is configured.

Runtime-editable languages and optional modules need one validated configuration snapshot shared by public rendering, APIs, previews, template resolution, and workers. Publication swaps that snapshot atomically. Existing installations migrate their deployment defaults into the new schema without changing public behavior. Secrets and infrastructure settings stay outside publication data.

Language removal requires a review of existing signers and templates. Store explicit language codes for new and migrated records. The current `NULL` meaning of default language must not silently change when the default changes. Preserve old mail links and explain fallback.

Acceptance criteria:

- A fresh organizer configures the agreed settings without editing a repository file.
- Reloading or leaving setup retains the draft. Conflicting saves retain both versions for review.
- All blocking requirements link directly to their repair control.
- Missing translations, disabled modules, and unavailable infrastructure checks have distinct states.
- Existing live installations remain usable throughout migration, and setup never resets signer or mailing state.

## Maps for cities, regions, and countries

The organizer chooses the geographic area covered by the letter. A city letter can count support by district. A national letter can count support by region. A letter can also collect an area without displaying a map.

The first release supports supplied geography presets and validated GeoJSON imports containing Polygon and MultiPolygon features. Every preset includes its source, license, attribution, and dataset version. Germany remains one preset. Include a city-district example and a non-German example to check that rendering works without Germany-specific code. Verify redistribution rights before shipping any preset.

The import workflow is:

1. Upload boundaries and inspect a preview.
2. Choose stable area identifiers and display labels from the available properties.
3. Set localized field wording, such as **District**, **Borough**, or **Region**.
4. Review duplicate identifiers, unmapped existing values, geometry errors, and attribution.
5. Publish the map and field configuration together.

An optional searchable area selector supplies the same stable identifiers used by the map and audience filters. Include **Outside this area** and **Prefer not to say**. The first release does not request a street address, exact location, or browser geolocation.

Store geography, signer area, and organizational affiliation separately. An existing Kreisverband is sometimes a political organization rather than a district. Keep its original value when an organizer introduces a geographic field. An explicit mapping can attach an existing value to an area, but unresolved values remain unresolved.

The data model distinguishes a geography dataset, its stable areas, and a signer's optional area assignment. Display labels can change without changing identity. A dataset replacement previews affected assignments and requires explicit remapping. Do not match areas solely by old labels or identical names.

Render normalized geometry and escaped labels. Bound upload size, feature count, coordinate count, and geometry complexity. Reject external references and executable content. Calculate projection, bounds, and marker placement from the dataset. Keep an accessible list beside the visual map and support keyboard selection and small-screen use.

Public counts use the same visibility rules as the public signer list. Small-area counts and breakdowns need suppression to reduce identification risk. The proposed default suppresses values below five and avoids exposing those values through related totals or API breakdowns. Private admin totals remain available. Unknown and outside-area counts have explicit labels.

Acceptance criteria:

- Switching between the Germany, city-district, and non-German fixtures requires no renderer or resolver edits.
- The map, form, filters, and aggregate API use the same published identifiers and labels.
- Private signers do not enter public area counts. Exact personal coordinates are never returned.
- Invalid imports leave the published map available. Remapping never changes a signature's verification or consent.
- Public pages need no third-party map tiles or external geocoding to render the selected areas.

## Signature moderation

Add a dedicated **Signaturen** view with verification, requested public visibility, moderation status, and date filters. Keep newsletter eligibility visible as a separate fact.

The initial actions hide a public entry, restore it, and mark an entry for review. Each action records a reason and time. A minimal action history works with the existing administrator login and does not require team accounts.

Store moderation independently of `show_publicly`. Hiding an entry must not overwrite a signer's own privacy choice. Restoring an entry displays it only when the signer requested public visibility. A hidden valid signature still contributes to the verified total. The interface explains the difference between verified signatures and publicly listed signatures.

Moderation does not rewrite names, opt people into mail, withdraw signatures, or permanently delete records. Suspected duplicates and invalid signatures can be flagged for review. Automatic invalidation, public report forms, and a broader fraud system are deferred.

Acceptance criteria:

- Administrators can review verified signatures that have no newsletter consent.
- Hiding an entry removes it from public lists, search, maps, and public breakdowns after cache invalidation.
- Hiding or restoring an entry changes neither the verified total nor email eligibility.
- Bulk actions show the affected count and result, preserve filters, and support undo where the underlying records still exist.
- Erasure removes identifying moderation records, and restoration preserves the existing erasure protections.

## Campaign effectiveness

Add **Wirkung** to the statistics area. The organizer can inspect date ranges, trends, confirmation delays, language distribution, and aggregate referral results.

Define each measure:

| Measure                | Definition                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Eligible visits        | Visits counted under the current analytics policy. They are approximate and exclude DNT, GPC, recognized bots, and private links.         |
| New signature requests | Newly created pending signatures. Resends and repeated requests for an existing signature do not count again.                             |
| Confirmed signatures   | Successful first confirmations. Show daily confirmations separately from confirmations grouped by original request date.                  |
| Confirmation rate      | Confirmed requests divided by new requests from the same cohort. Recent cohorts remain provisional until the confirmation window expires. |
| Confirmation delay     | Time between the qualifying request and its first successful confirmation.                                                                |
| Referral results       | Aggregate confirmed invitations under the existing referral rules. No permanent relationship graph is added.                              |

Visits and signature requests have different collection rules. Show their counts together, but do not label their ratio an exact visitor conversion rate. Accurate channel-level conversion attribution is outside the first release. Keep personal invitation pages excluded from visit tracking.

Request and confirmation counters come from successful database transitions. Retries cannot increment them twice. Aggregate before unconfirmed rows expire. Define the cohort window and treatment of renewed expired requests before implementation. Existing installations show **Data available since ...** rather than reconstructing missing history.

Statistics stay optional. When disabled, new effectiveness measurements stop. Apply the existing bot, DNT, and GPC policy to optional request measurements. Confirmation accounting inherits the original measurement eligibility rather than treating an emailed confirmation link as an analytics page visit. Operational signature totals remain available independently.

Set a documented retention period for aggregates, proposed at 30 days initially. Store no email addresses, raw tokens, precise locations, or signer-level browsing histories in the report. Explain erasure and aggregate retention in the privacy wording.

Acceptance criteria:

- Duplicate requests, resends, expired tokens, restored backups, and repeated confirmation clicks do not inflate counters.
- Cohorts reconcile with known fixture transitions, including requests confirmed on a later day.
- Recent data, unavailable history, stale reads, and analytics exclusions are visible in the report.
- No public tracking script, email-open pixel, or individual browsing profile is introduced.

## Reusable audiences and communication preferences

Within **Unterzeichner**, an organizer filters newsletter-eligible people and chooses **Als Zielgruppe speichern**. A saved audience has a name, a readable rule summary, a current count, and language counts.

Start with existing filters, then add explicit language, geographic area, and private organizer tags. Support all required conditions plus any selected tag. Avoid a general expression builder in the first release.

Explain the difference between rules and selections:

- A saved audience stores filter rules and resolves eligible members when used.
- A manual selection stores selected IDs and always rechecks current eligibility.

When scheduling against a saved audience, save the approved rule version with the message. Later edits to the saved audience do not rewrite that scheduled rule. Membership can still change as people qualify, unsubscribe, or are erased. Approval explains this and reuses current counts, language review, and template warnings.

Private tags help organizers group people. They never appear on public pages and never grant permission to send. Removing a tag does not erase a signature. Bulk tag changes preview their effect and preserve existing selections across filters.

The first preference improvement adds language and newsletter settings to the existing self-service page. Topic subscriptions can follow when organizers have real topics to offer. Keep all opt-ins explicit and retain a clear unsubscribe-all action. Existing subscribers keep their existing consent scope. A tag, geography choice, or signature alone does not create a subscription.

Acceptance criteria:

- Saved audiences survive reload and show their rule and last evaluation time.
- Every preview, approval, retry, and worker uses the same eligibility rules.
- Unsubscription or erasure after scheduling excludes the person at delivery time.
- Editing or deleting a saved audience does not silently change an approved schedule.
- Tags and audience membership disappear with the person on erasure. Backups retain the current restoration safeguards.

## Base UI for hand-built admin controls

Use the installed `@base-ui/react` primitives where they fit the control's behavior. Keep the existing CSS and product wording.

| Hand-built control               | Base UI component                                                           |
| -------------------------------- | --------------------------------------------------------------------------- |
| Actions and submission buttons   | Button, with explicit submit behavior where required                        |
| Text and password inputs         | Input with Field for labels, descriptions, and errors                       |
| Numeric settings                 | NumberField when increment, bounds, and parsing behavior are useful         |
| Checkboxes and grouped choices   | Checkbox, CheckboxGroup, RadioGroup, or Switch according to the interaction |
| Selection and search             | Select, Combobox, or Autocomplete                                           |
| Expandable details               | Collapsible or Accordion                                                    |
| Modals and confirmations         | Dialog or AlertDialog                                                       |
| Action menus and anchored panels | Menu or Popover                                                             |
| Tabs and formatting controls     | Tabs, Toolbar, Toggle, and ToggleGroup where appropriate                    |
| Progress and hints               | Progress, Meter, and Tooltip where those semantics fit                      |

The existing [admin controls](publishing.md) now use Base UI buttons, checkboxes, inputs, selectors, dialogs, menus, tabs, disclosures, formatting toggles, and the statistics day slider. New features must follow the same policy. Native browser file and color pickers and the existing calendar are documented exceptions.

Puck's own interface, Tiptap's editing engine, and CodeMirror stay in place. Their surrounding app controls use the same Base UI policy. Keep semantic headings, links, tables, charts, and map geometry. Retain browser file and color controls where Base UI has no appropriate equivalent. Document each exception instead of forcing a mismatched component.

Inventory controls by interaction and migrate one interaction at a time. Base UI components themselves can render native elements, so a raw DOM tag count cannot verify adoption. A source check can identify unsupported hand-built controls, with explicit exceptions for editor-owned code and browser-specific controls.

Acceptance criteria:

- Every supported hand-built admin interaction uses the relevant Base UI primitive.
- The inventory names and explains the remaining exceptions.
- Keyboard order, focus restoration, pending feedback, form submission, labels, errors, and narrow-screen containment remain correct.
- The migration preserves calendar behavior, publication drafts, recipient selections, and delivery approval. The existing calendar library stays where Base UI has no equivalent.

## Delivery sequence

Check each phase in the running app before starting the next.

| Phase | Deliverable                                                            | Completion evidence                                                                                                                     |
| ----- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Base UI inventory and migration for existing hand-built admin controls | Inventory has no unexplained supported exceptions. Keyboard and mobile workflows pass.                                                  |
| 2     | Runtime settings and geography model                                   | Existing installations migrate without behavior changes. Languages, form fields, boundaries, and previews share one validated snapshot. |
| 3     | Guided setup with configurable maps                                    | A new organizer launches a city-based or non-German fixture through the admin. Deployment tasks have truthful status.                   |
| 4     | Signature moderation                                                   | All-signature review works independently of newsletter eligibility. Privacy and count invariants pass.                                  |
| 5     | Effectiveness reporting                                                | Known request and confirmation cohorts produce correct aggregate reports under retention and privacy rules.                             |
| 6     | Saved audiences, tags, and preference improvements                     | Scheduled rule versions remain stable, and late opt-outs are honored across delivery and retry.                                         |

This roadmap does not change runtime behavior. Browser verification uses local drafts and intercepted operations rather than sending real campaign mail or activating providers.

## Decisions to confirm during implementation

Use these proposed defaults when planning implementation:

- Ship Germany, one city-district example, and one non-German example after license review. Choose the first real city when preparing those datasets.
- Use optional area selection and suppress public small-area values below five by default.
- Keep only simple audience rules in the first release.
- Begin with 30-day effectiveness aggregates. Add longer reporting only with matching retention controls and disclosures.
- Make profile preferences accessible through existing verified self-service links. Separate topic subscriptions remain a later increment.
