# Changelog

Each version is tagged in git (`v0.7` etc.).

## [Unreleased]

### Added
- Collapsible Stats section at the top of the popup: total requests and
  since when, how many roots cover 90% and 99% of requests, the share of the
  top 3 roots, roots under 1%, the share not trusted by default (roots not
  built in and certificate exceptions), and requests by CA operator.

### Changed
- "Built-in roots" is now "Seen built-in roots", so it can't be read as
  all built-in roots next to the "Never seen" list.

## [1.0.1] - 2026-10-02

### Changed
- Longer extension description that matches the AMO summary and mentions
  the highlighting of roots that aren't built in.
- The popup grows to 90% of the window height (Firefox allows at most
  600 px), and the list fills the extra space.
- Reset and Copy moved up next to Update list, so the list no longer loses
  room to a separate button bar. Reset is now "Reset seen" so it can't be
  mistaken for resetting the downloaded Mozilla list.
- Seen roots are sorted by request count, most used first, instead of by
  name. Copy still lists them by name.

### Development
- README shows the icon and a screenshot of the popup.
- PNG icons in 32, 64 and 128 px in `store/` for the AMO listing, rendered
  from `icons/icon.svg`.
- `make build`, `make lint`, `make check` and `make roots` run everything in
  Docker. The image defaults to `node:22` and can be overridden in a
  git-ignored `local.mk`.
- The package no longer contains an empty `scripts/` folder.

## [1.0.0] - 2026-10-02

First release on addons.mozilla.org.

### Added
- Fixed extension ID, data collection declaration ("none") and homepage link,
  as required for publishing.
- Banner with an "Allow access" button when access to all websites was
  turned off in about:addons, since nothing gets recorded without it.
- MIT license and README.

### Changed
- Requires Firefox 140 or later (current ESR): the first version that
  supports the data collection declaration, and late enough that host
  permissions are granted at install time (127+).

### Fixed
- The popup could show outdated data when a background write landed while it
  was opening.
- An "Update list" error stayed in the tooltip after a later successful update.
- The "Update list" button could stay stuck on "Updating…" if messaging the
  background failed, or reset its label too early after a quick retry.
- Roots missing from the Mozilla list were always said to be missing from the
  bundled list, even when a downloaded list was in use.

## [0.10] - 2026-10-01

### Added
- Extension and toolbar icon: a shield with a rooted tree.

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
