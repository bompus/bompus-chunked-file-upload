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
5. **Required:** create a GitHub Release for that tag **after** the tag exists on the remote. Paste **that version’s CHANGELOG section** into notes (not a work-log dump). Fallback one-liner only if the section is empty:

   ```bash
   gh release create X.Y.Z --title "X.Y.Z" --notes-file - <<'EOF'
   <paste ## [X.Y.Z] section from CHANGELOG.md>
   EOF
   ```

   Do **not** skip Release creation for future bumps.
6. Do **not** attach Release assets (no built `.min.js`). jsDelivr minifies from the tagged source file; there is no committed minify step unless this repo adds one later.
7. Verify CDN before telling consumers to bump: `curl` the `@X.Y.Z` `.min.js` (and `.min.css`) until 200 + version string visible.

## Project invariants

- Vanilla JS, zero runtime deps; keep engine + `mountDefaultUi` in the single CDN file (intentional size).
- Public API / events stay identity-sentinel style (`=== SKIP_UPLOAD`, etc.).
- `beforeRequest` is **per request**; session fields use `setUploadFormData` / `clearUploadFormData`, not one-shot clears in `beforeRequest`.
- Prefer semver tags aligned with CHANGELOG headers.
- CHANGELOG is release-delta only (not a work log of every iterative change before the bump).

## Plan before non-trivial API changes

For non-trivial API changes: outline behavior + CHANGELOG bullets before editing; confirm with the user when the chat rules require it.
