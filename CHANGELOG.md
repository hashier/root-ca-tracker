# Changelog

Each version is tagged in git (`v0.7` etc.).

## [0.9] - 2026-10-01

### Added
- Bundled list of Mozilla's website roots (`mozilla-roots.json`, from CCADB),
  refreshed with `scripts/update-mozilla-roots.js`.
- "Update list" button downloads the current list from CCADB. The extension
  makes no network requests on its own; the popup shows the list's age and
  highlights it after 30 days.
- Popup shows "Seen Y of Mozilla's X website roots (Z%)".
- Collapsible "Never seen" list, grouped by organization like Firefox's
  Certificate Manager, with Firefox's TLS distrust dates.
- Seen built-in roots missing from the bundled list are marked, which
  means the list needs a refresh.
- Copy also exports the never-seen roots.

## [0.8] - 2026-10-01

### Added
- Clicking a root expands its full subject, SHA-256 fingerprint, first seen
  date and recent hosts, with a button to look it up on crt.sh.

## [0.7] - 2026-10-01

### Added
- Root records keep first/last seen, request count, expiry and the last few hosts.
- Roots that aren't built into Firefox are highlighted, since they can mean
  HTTPS traffic is being inspected.
- Separate list of certificate exceptions: hosts that loaded despite an
  untrusted issuer, domain mismatch or expired certificate.
- Popup updates live, supports dark mode and shows a shortened fingerprint
  to tell same-name roots apart.

### Changed
- Storage writes are batched to at most one every 2 seconds.
- Copy exports roots with fingerprints, plus the exceptions.

## [0.6] - 2026-10-01

### Changed
- Roots are keyed by SHA-256 fingerprint instead of issuer name. The old
  `rootCAs` list stays in storage but is no longer shown.
- Untrusted chains are no longer recorded as roots.

### Fixed
- Requests arriving while the background was starting could overwrite the
  stored list.
- Reset and Copy feedback used `confirm()`/`alert()`, which don't work in
  Firefox popups.
- Undeclared `sorted` variable leaked into a global.

## [0.5] - 2025-09-17

- Initial version: records the root CA name of every HTTPS connection and
  lists them in the popup.
