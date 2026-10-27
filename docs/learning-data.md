# Learning progress, storage and private backups

## A desktop app, without a development server

Open **T3Learn.app** from Finder, or drag it from the DMG to Applications. It starts its internal server automatically and opens a native Electron window. No Terminal command, development server or browser tab is needed for normal learning. The CLI subscriptions still require installed Codex/Claude Code and an account login. Building the app is documented in [local-desktop.md](local-desktop.md).

## Lesson attachments and handwritten answers

Use **Attach images or PDF** in the home, new-session or chat input. Images can also be pasted or dropped into the input. Attach up to four files per message, 10 MB each. Supported formats are PNG, JPEG, WebP and PDF. PDFs show a page selector: blank means all pages for a document of ten pages or fewer; larger documents require an explicit selection of up to ten pages. Selected PDF pages are sent as both extracted text and rendered images, including scans and diagrams. The conversation model must support images. Finish any running response before sending attachments.

For an answer, use **Add handwritten thinking**, then **Convert to editable text**. The draft is inserted into Your thinking (or Your answer for free-response questions). Review and edit it before submitting. Transcription preserves visible mistakes and marks unclear content; it does not grade or solve. Existing typed text is retained. The original images accompany the submitted answer so the teacher can inspect diagrams and spatial reasoning. Transcription uses the session's selected model if image-capable, otherwise the configured Vision slot; it uses that connection's normal allowance and never submits an answer automatically.

Files and their prepared model context live in `data/attachments/<id>/`, separate from the chat JSON. Chat records contain small attachment references. Original files remain available from their transcript cards when you reopen the session. Uploading or transcribing does not import documents into the knowledge graph. Normal teacher-prose extraction from the ensuing lesson continues as before. The context is sent to your selected provider when used; it is not an offline OCR feature.

**The private GitHub backup excludes attachment files.** It includes the transcript references and submitted text. To preserve the original images/PDFs, separately copy the `attachments/` directory. On a restore without those files, the app reports them as unavailable instead of inventing their contents. Removing a preview removes it from the outgoing message; it does not erase local upload files. Images and PDFs can account for most of your disk usage.

## Progress

For daily subject selection, learning goals and strictly chosen spaced review, see [Daily learning](daily-learning.md). These records are separate from the knowledge graph and the activity totals below.

The **Progress** button beside Settings opens your XP, level, milestone badges, streaks, 30-day calendar and knowledge-map statistics. Every answered learning question earns 20 XP; each 200 XP advances one level (starting at level 1). Honest “I don’t know” responses count. Skips, preference questions, failed tools and unanswered questions do not. Duplicate results cannot award XP twice.

The totals are derived from the existing saved records. A human message, practice step or answered learning question makes an active day in the viewer's timezone. Yesterday's streak remains current until today ends. Deleting history can reduce XP, streaks and badges. Graph counts reflect deduplicated propositions and reasoning chains, including imported notes. They do not measure mastery. No game data enters the teaching prompts, changes grading or modifies the learning tools.

## Where knowledge is stored

The local macOS edition stores its records under:

```text
~/Library/Application Support/LearnHarness Local/data/
  chats/<chat-id>.json
  graph/nodes.jsonl
  graph/chains.jsonl
  graph/coverage.jsonl
  graph/sessions.jsonl
  graph/sources.json
  graph/format.json
  settings.json
  learning.json
```

- Each chat JSON contains its native transcript, structured answers, confidence/thinking fields, model settings and usage records.
- `learning.json` stores learning goals, chosen review objectives, session context and the daily time preference. Review evidence comes from the corresponding chat transcripts.
- `nodes.jsonl` stores propositions: a short name, full statement, alternate phrasings and provenance pointing to source messages.
- `chains.jsonl` stores reasoning arguments: premise IDs, a conclusion ID and provenance. Repeated assertions are merged when the graph is read; canvas arrows are derived from these chains.
- `coverage.jsonl` tracks which message content has been extracted. Extraction runs in the background once enough uncovered teaching content accumulates, or through the existing manual extraction flow. A new chat does not immediately imply new graph nodes.
- Other graph JSON files retain imported-note source references, format versions, layout and display settings.

The original LearnHarness app uses a separate `LearnHarness` directory. Web development defaults to this checkout's ignored `data/` folder unless `LH_DATA_DIR` is set. Back up the directory belonging to the app you actually use.

These are plain-text records, not a hosted database and not files inside the app bundle. Replacing the app does not remove them. The app sends the relevant context to the chosen model provider when learning; local storage does not mean offline inference.

## Expected size

A short two-answer QA lesson measured 13,505 bytes. That is a small sample, not an average or a cap. For planning, 1,000 sessions averaging 100 KB would occupy about 100 MB before Git history. Long conversations, repeated tool outputs and inline images can be much larger. PDFs/images/external learner files often dominate storage and may live outside this data directory.

The progress dashboard adds no persistent score database. Git history retains prior versions, so the private backup repository can grow beyond the latest snapshot's size.

## Private GitHub backup

Public code: <https://github.com/felixlaga/t3learn>. Personal backups: **private** <https://github.com/felixlaga/t3learn-data>.

The backup is manual and one-way. It is not automatic multi-device synchronization. Quit LearnHarness before taking a backup for a consistent snapshot. With Node and the GitHub CLI installed and `gh auth login` completed, run from this checkout:

```sh
npm run data:backup -- --repo felixlaga/t3learn-data
```

The default on macOS is the Local app's data directory shown above. For a different installation, pass `--data /absolute/path/to/data`. The command verifies the destination is private, takes a checksum inventory, checks for changes during collection, commits a snapshot and pushes. An unchanged snapshot produces no new commit. Existing remote work is never force-pushed.

Included: chat JSON, the known graph JSON/JSONL files, `learning.json`, and nonsecret `settings.json`. Excluded: auth files, CLI configuration/credentials, debug logs, background job state, caches, prompt overrides and external attachment directories. Inline images already present inside a chat record remain part of that record. An individual record over 10 MiB causes the backup to stop rather than silently omit that record; larger media need separate storage. This is a learning-record backup, not a complete computer backup.

API keys are in a separate `auth.json` above the data directory, and subscription credentials remain with the CLIs/Keychain. Those credential stores are never included. Private repository contents are not end-to-end encrypted by this script; people you grant repository access can read them. Deleted learning records disappear from the latest snapshot but remain in earlier Git commits.

## Restore without overwriting live data

First restore to a **new, nonexistent** directory:

```sh
npm run data:restore -- --repo felixlaga/t3learn-data --output "$HOME/Desktop/T3Learn-restored-data"
```

The script checks every file against the SHA-256 manifest before writing and refuses existing destination directories. Inspect the recovered files. Then quit the app, keep a separate copy of its current data directory, and use Finder to copy the recovered learning files into its data directory. Reopen the app. Existing credentials are separate and are not restored or replaced by this process. To recover an older snapshot, clone the private repository and check out the desired commit before using its `snapshot/` files.

## Free storage options checked 2026-10-26

[GitHub Free](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) includes private repositories. [GitHub's file guidance](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) blocks individual files above 100 MiB and recommends small repositories. This fits a modest collection of text learning records; it is not unlimited media storage.

A future hosted-database implementation could use [Supabase Free](https://supabase.com/pricing): 500 MB database and 1 GB file storage, with free projects paused after a week of inactivity. That would require a new authenticated storage/synchronization adapter. This edition keeps the existing local storage and uses private GitHub snapshots for recovery.
