# Delivery and storage ownership

One process serves one letter and one encrypted database. Honker uses the business connection and database file, which lets a transaction commit both a data change and its email job. A separate outbox would duplicate the existing queue's persistence and retry rules.

## Accepted work survives restart

`server/durable-work.js` owns readiness and transactional enqueue. Routes put signup, token replacement, registration, or campaign changes inside `durableWork.run`. An enqueue failure rolls back the operation. `durableWork.email` requires that transaction and assigns a stable logical message ID. Invitation credentials are generated once when the job is created.

`db/jobs.js` owns job initialization, scheduling, polling, acknowledgement, and retry. Campaign and transactional email workers run separately from maintenance. `server/request-drain.js` tracks accepted HTTP operations during shutdown. Readiness becomes false before the process waits for requests and workers to finish.

`server/index.js` composes these services, configures routes, and starts the process. It does not provide an inline email fallback. When jobs fail to initialize, public reads and authorized privacy actions remain available, but readiness is false and operations that need durable mail return 503.

## One recipient reaches the provider at a time

`server/campaign-delivery.js` owns campaign audience selection and progress. It reads the audience once per run and prepares one message at a time. `server/meeting-service.js` owns registration mail and scheduled meeting mail. Both dispatch through the email manager in `server/email-setup.js`.

The manager prepares the message lazily, waits outside a transaction for normal account pacing, and reserves the attempt and send slot together. It checks the original recipient identity and current consent after waiting, immediately before provider I/O. The transaction ends before the network call. Provider cooldowns defer work. Uncertain SMTP recipients need reconciliation while other recipients can proceed.

Attempt identity survives retries and provider-profile changes. An already accepted logical message skips preparation, so replay cannot rotate an invitation credential. Acceptance updates the existing attempt and conditionally records delivery for the original recipient. Erasure can delete an attempt while its provider call is in progress. Completion cannot insert that attempt again.

## A meeting date identifies separate work

`server/meeting-repository.js` owns settings revisions, event generations, claims, and delivery records. Changing the date or explicitly resetting delivery advances the generation in the settings transaction. Other settings edits change the revision without creating a new event.

Every worker checks its generation before sending and before writing progress or completion. A result from an earlier event cannot complete the next event. Generation zero preserves legacy delivery identities during upgrades to avoid resending already accepted mail.

A delayed registration confirmation uses the current meeting date. If the date changes while it prepares, the job retries. Delegate edits preserve the registration identity. Registering again for a later event renews it.

## Erasure covers every recipient store

`db/erasure.js` defines the shared deletion operation for live requests and backup restoration. The caller authorizes deletion and records the keyed restore tombstone in the same transaction. The operation covers signatures, meeting registrations, pending requests, queued messages, delivery logs, and identifiable attempts. Restore supplies a cutoff so newer activity survives an older erasure.

`db/email-identity.js` supplies the keyed address hash. `db/email-attempts.js` binds historical attempts to recoverable subjects without changing their provider retry identity. See [security](security.md#erasure-and-in-flight-mail) for unmatched legacy attempts and messages already submitted to a provider.

## Publication content has a lifetime

`server/publications.js` owns stored-document reconciliation, submission validation, revision comparison, and the published snapshot. Startup adapts stored content to current configuration. Unsupported editorial values stay in the document's archive. Strict submission validation remains separate.

The publication is the active template catalog. Historical SQL template rows keep campaign references valid after retirement. New campaign creation checks the active catalog, while already accepted campaigns retain their original template identity. Retry review and delivery resolve retired templates, including language variants, from those rows.

`server/asset-lifecycle.js` tracks image references, recent uploads, and the bounded serving cache. Preview generation stores no images. Publication commits generated images with the document, and collection retains the current and preceding revisions. Browser drafts can outlive the upload grace period, so a draft is not an image backup.

## Transactions have one owner

`db/connection.js` serializes transactions and rejects nested or cross-connection use from within a transaction. Internal operations accept the transaction's connection when needed. The public read cache is bypassed inside transactions, so a transaction cannot wait on a cached query queued behind itself or publish uncommitted values.

Meeting and milestone forms own their loaded baseline, input values, validation, and dirty state. `src/AdminApp.jsx` owns session and area navigation. Keyed form state prevents a stale response from replacing a different session's settings.
