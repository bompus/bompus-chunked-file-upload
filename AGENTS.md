# Agent rules — bompus-chunked-file-upload

## Release / version bumps

1. Bump version in the **same** commit:
   - JS banner (`Bompus Chunked File Upload vX.Y.Z`)
   - `CHANGELOG.md` — one `## [X.Y.Z]` section
   - `README.md` Prefer/CDN `@X.Y.Z` URLs
   - `example.html` title if present
2. **CHANGELOG discipline:** Write only the **clean delta** for what ships in this version (user-facing / API / behavior consumers care about). Do **not** log every intermediate edit, WIP commit, or agent/human iteration while the next version was in progress. Collapse refactors and false starts into the net outcome (or omit if invisible to consumers). Prefer Keep a Changelog style bullets under one section at release time.
3. Commit on `master`, push.
4. Create and push git tag `X.Y.Z` matching the banner (annotated OK). jsDelivr `gh/...@tag/` resolves this tag.
5. **Required:** create a GitHub Release for that tag **after** the tag exists on the remote. Paste **that version’s CHANGELOG section** into notes (not a work-log dump).
6. Do **not** attach Release assets (no built `.min.js`). jsDelivr minifies from the tagged source file.
7. Verify CDN before telling consumers to bump: `curl` the `@X.Y.Z` `.min.js` (and `.min.css`) until 200 + version string visible.

## Project invariants

- Vanilla JS, zero runtime deps; engine + default UI in the single CDN file.
- **Pick ≠ upload** — never auto-upload on file input change; public entry is `mount` + `upload` / `bindInput`.
- Wire protocol: `initFile` → sequential `sendChunk`(s) → `combineChunks`. Per-upload fields via `upload(file, { data })`.
- Form busy: transfer holds automatically; dialogs use `holdFormBusy`.
- Prefer semver tags aligned with CHANGELOG headers.
- CHANGELOG is release-delta only (not a work log of every iterative change before the bump).

## Plan before non-trivial API changes

For non-trivial API changes: outline behavior + CHANGELOG bullets before editing; confirm with the user when the chat rules require it.
