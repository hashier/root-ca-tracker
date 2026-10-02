# Root CA Tracker

A Firefox extension that records which root certificate authorities your
HTTPS connections actually chain to, and compares them with the roots Mozilla
ships. Firefox trusts around 120 roots for websites; most people only ever use
a handful. Knowing which ones is the first step to trimming the rest.

## What it shows

- **Seen roots** with request counts, first/last seen, expiry and recent hosts.
- **Roots that aren't built into Firefox**, highlighted. These are installed by
  you or by software (corporate proxies, antivirus, dev tools) and can mean
  your HTTPS traffic is being inspected.
- **Certificate exceptions**: hosts that only load because you accepted a
  certificate warning.
- **Never-seen roots** from Mozilla's list, grouped like Firefox's Certificate
  Manager, and "seen Y of X website roots".

## Privacy

Everything stays in the extension's local storage. The extension makes exactly
one kind of network request, and only when you click **Update list**: it
downloads Mozilla's public root list from [CCADB](https://www.ccadb.org/).
A copy of that list is bundled, so the button is optional.

## Install

From [addons.mozilla.org](https://addons.mozilla.org/) (link follows once
listed), or for development: `about:debugging` → This Firefox → Load Temporary
Add-on → select `manifest.json`.

Works in Firefox 140+ and Firefox-based browsers such as LibreWolf. It relies on
Firefox-only APIs (`webRequest.getSecurityInfo`), so there is no Chrome version.

## Development

Refresh the bundled root list:

```sh
node scripts/update-mozilla-roots.js
```

Lint and build the package:

```sh
npx web-ext lint --ignore-files "scripts/**"
npx web-ext build --ignore-files "scripts/**" README.md CHANGELOG.md
```

## License

MIT, see [LICENSE](LICENSE).
