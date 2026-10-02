const summary = document.getElementById("summary");
const content = document.getElementById("content");
const copyBtn = document.getElementById("copy");
const resetBtn = document.getElementById("reset");
const listStatus = document.getElementById("list-status");
const listAge = document.getElementById("list-age");
const updateListBtn = document.getElementById("update-list");
const permissionBanner = document.getElementById("permission-banner");
const grantBtn = document.getElementById("grant-access");

const CONFIRM_TIMEOUT_MS = 3000;
const STALE_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Latest stored data plus the Mozilla list in use (null if none could be
// loaded), used by Copy and live re-renders.
let current = { roots: {}, exceptions: {}, mozilla: null };

// Fingerprints of roots whose details are open. Kept here so live
// re-renders don't collapse them.
let expanded = new Set();
let neverSeenOpen = false;
let statsOpen = false;

// --- Formatting (pure) ---

// "CN=ISRG Root X1,O=Internet Security Research Group,C=US" -> "ISRG Root X1".
// Falls back to O=, then the full subject, for roots without a CN.
const subjectField = (subject, key) => subject?.match(new RegExp(`(?:^|,)${key}=([^,]+)`))?.[1];

const displayName = subject =>
    subjectField(subject, "CN") ?? subjectField(subject, "O") ?? subject ?? "(unknown)";

const formatDate = ms => (ms ? new Date(ms).toISOString().slice(0, 10) : "?");

// Enough of the fingerprint to tell same-name roots apart.
const shortFingerprint = fp => (fp ? `${fp.slice(0, 23)}…` : "");

// crt.sh accepts a SHA-256 fingerprint as hex without separators.
const crtShUrl = fingerprint => `https://crt.sh/?q=${fingerprint.replaceAll(":", "")}`;

const toggled = (set, key) =>
    set.has(key) ? new Set([...set].filter(k => k !== key)) : new Set([...set, key]);

const byName = ([, a], [, b]) => displayName(a.subject).localeCompare(displayName(b.subject));

// Most used first; roots stored before request counting have none.
const byRequests = (a, b) => (b[1].requests ?? 0) - (a[1].requests ?? 0) || byName(a, b);

// Firefox writes "AB:CD:...", CCADB writes "ABCD...".
const normalizeFingerprint = fp => fp.replaceAll(":", "").toUpperCase();

// The list only covers roots trusted for websites, so a seen built-in root
// missing from it usually means the list is outdated.
const compareWithMozilla = (roots, mozillaRoots) => {
    const seen = new Set(Object.keys(roots).map(normalizeFingerprint));
    const neverSeen = mozillaRoots.filter(r => !seen.has(r.sha256));
    return {
        total: mozillaRoots.length,
        seenCount: mozillaRoots.length - neverSeen.length,
        neverSeen,
        listed: new Set(mozillaRoots.map(r => r.sha256)),
    };
};

// Firefox's Certificate Manager groups roots by organization; the one root
// without an O= is assumed to be listed under its own name.
const organizationOf = mozillaRoot => mozillaRoot.organization || mozillaRoot.name;

const ageInDays = (isoDate, now) => Math.floor((now - Date.parse(isoDate)) / DAY_MS);

const ageText = days => (days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`);

// Prefers the downloaded list, unless the bundled one is newer (after an
// extension update). ISO dates compare correctly as strings.
const newerList = (bundled, downloaded) =>
    !downloaded ? bundled
        : !bundled ? downloaded
            : downloaded.fetched >= bundled.fetched ? downloaded : bundled;

const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

const mozillaRootMeta = r => [
    r.validTo ? `valid until ${r.validTo}` : undefined,
    r.distrustTlsAfter ? `Firefox distrusts its TLS certs issued after ${r.distrustTlsAfter}` : undefined,
].filter(Boolean).join(" · ");

// Entries recorded before these fields existed lack them until seen again.
const rootMeta = (root, unlistedIn) => [
    unlistedIn ? `not in Mozilla's list from ${unlistedIn}` : undefined,
    root.requests ? `${root.requests} requests` : undefined,
    root.lastSeen ? `last seen ${formatDate(root.lastSeen)}` : undefined,
    root.validUntil ? `valid until ${formatDate(root.validUntil)}` : undefined,
].filter(Boolean).join(" · ");

// Firefox returns no certificates for untrusted chains, so most exceptions
// have no subject or issuer.
const certLine = exception => exception.subject
    ? `cert: ${displayName(exception.subject)} · issued by ${displayName(exception.issuer)}`
    : "certificate details not available";

const exportText = ({ roots, exceptions, mozilla }) => {
    const rootLines = Object.entries(roots).sort(byName).map(([fp, r]) =>
        `${r.isBuiltInRoot === false ? "[NOT BUILT-IN] " : ""}${r.subject}  ${fp}`);
    const exceptionLines = Object.entries(exceptions).map(([host, e]) =>
        `${host}  (${e.reasons.join(", ")})  ${e.subject ?? "-"}`);
    const mozillaLines = mozilla
        ? (({ total, seenCount, neverSeen }) => [
            "",
            `Never seen, from Mozilla's list fetched ${mozilla.fetched} ` +
                `(seen ${seenCount} of ${total} website roots):`,
            ...neverSeen.map(r => `${organizationOf(r)} / ${r.name}  ${r.sha256}`),
        ])(compareWithMozilla(roots, mozilla.roots))
        : [];
    return [
        `Root CAs (${rootLines.length}):`, ...rootLines,
        "",
        `Certificate exceptions (${exceptionLines.length}):`, ...exceptionLines,
        ...mozillaLines,
    ].join("\n");
};

// --- Stats (pure) ---

const STATS_TOP_ROOTS = 3;
const STATS_TOP_OPERATORS = 5;
const SMALL_SHARE = 0.01;

const sum = numbers => numbers.reduce((a, b) => a + b, 0);
const requestsOf = record => record.requests ?? 0;

// Rounds, but never shows a non-zero share as 0% or a partial one as 100%.
const percentText = (part, whole) => {
    const share = whole ? part / whole : 0;
    if (share > 0 && share < 0.01) return "<1%";
    if (share < 1 && share > 0.99) return ">99%";
    return `${Math.round(share * 100)}%`;
};

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// How many of the busiest roots it takes to reach `share` of all requests.
// `counts` must be sorted, busiest first.
const rootsToCover = (counts, share) => {
    const target = sum(counts) * share;
    const running = counts.map((_, i) => sum(counts.slice(0, i + 1)));
    return running.findIndex(total => total >= target) + 1;
};

// The CA operator as Mozilla lists it, else the root's own O= field.
const operatorOf = ([fingerprint, root], listed) => {
    const mozillaRoot = listed.get(normalizeFingerprint(fingerprint));
    return mozillaRoot
        ? organizationOf(mozillaRoot)
        : subjectField(root.subject, "O") ?? displayName(root.subject);
};

// Shares of root requests are relative to requests that reached a root;
// requests through a certificate exception have none and only count towards
// the total and the "not trusted by default" share.
const computeStats = (roots, exceptions, mozillaRoots = []) => {
    const rootEntries = Object.entries(roots);
    const counts = rootEntries.map(([, r]) => requestsOf(r)).sort((a, b) => b - a);
    const rootRequests = sum(counts);
    if (rootRequests === 0) return undefined;

    const exceptionRequests = sum(Object.values(exceptions).map(requestsOf));
    const notBuiltInRequests = sum(rootEntries
        .filter(([, r]) => r.isBuiltInRoot === false)
        .map(([, r]) => requestsOf(r)));
    const listed = new Map(mozillaRoots.map(r => [r.sha256, r]));
    const operators = Object.entries(Object.groupBy(rootEntries, entry => operatorOf(entry, listed)))
        .map(([name, group]) => ({ name, requests: sum(group.map(([, r]) => requestsOf(r))) }))
        .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name));
    const firstSeen = [...Object.values(roots), ...Object.values(exceptions)]
        .map(r => r.firstSeen)
        .filter(Boolean);

    return {
        allRequests: rootRequests + exceptionRequests,
        rootRequests,
        since: firstSeen.length ? Math.min(...firstSeen) : undefined,
        rootCount: counts.length,
        topRequests: sum(counts.slice(0, STATS_TOP_ROOTS)),
        cover90: rootsToCover(counts, 0.9),
        cover99: rootsToCover(counts, 0.99),
        smallRoots: counts.filter(c => c < rootRequests * SMALL_SHARE).length,
        untrustedRequests: notBuiltInRequests + exceptionRequests,
        operators,
    };
};

const statsLines = s => [
    `${s.allRequests.toLocaleString()} requests` + (s.since ? ` since ${formatDate(s.since)}` : ""),
    s.rootCount > STATS_TOP_ROOTS
        ? `Top ${STATS_TOP_ROOTS} roots: ${percentText(s.topRequests, s.rootRequests)} of requests`
        : undefined,
    `90% of requests: ${plural(s.cover90, "root")} · 99%: ${plural(s.cover99, "root")}`,
    s.smallRoots ? `${plural(s.smallRoots, "root")} under 1% each` : undefined,
    `Not trusted by default: ${percentText(s.untrustedRequests, s.allRequests)}` +
        " (roots not built in, certificate exceptions)",
].filter(Boolean);

// The busiest operators, with the rest folded into one line. A single
// leftover operator is shown by name, since folding it saves no space.
const operatorLines = ({ operators, rootRequests }) => {
    const shown = operators.length > STATS_TOP_OPERATORS + 1 ? STATS_TOP_OPERATORS : operators.length;
    const rest = operators.slice(shown);
    return [
        ...operators.slice(0, shown)
            .map(o => `${percentText(o.requests, rootRequests)} ${o.name}`),
        rest.length
            ? `${percentText(sum(rest.map(o => o.requests)), rootRequests)} ${plural(rest.length, "other")}`
            : undefined,
    ].filter(Boolean);
};

// --- DOM ---

// Server-supplied strings (subjects, hosts) only ever go into textContent.
const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter(c => c !== undefined));
    return node;
};

const detail = (label, value, className = "") => el("div", { className: `meta ${className}` },
    el("span", { className: "label", textContent: `${label}: ` }),
    el("span", { textContent: value }));

const rootDetails = (fingerprint, root) => el("div", { className: "details" },
    detail("Subject", root.subject),
    detail("SHA-256", fingerprint, "fp"),
    root.firstSeen ? detail("First seen", formatDate(root.firstSeen)) : undefined,
    root.hosts?.length ? detail("Recent hosts", root.hosts.join(", ")) : undefined,
    el("button", {
        textContent: "Look up on crt.sh",
        onclick: event => {
            event.stopPropagation();
            browser.tabs.create({ url: crtShUrl(fingerprint) });
        },
    }),
);

const rootSummary = (fingerprint, root) => [
    root.hosts?.length
        ? el("div", { className: "meta", textContent: `e.g. ${root.hosts.join(", ")}` })
        : undefined,
    el("div", { className: "meta fp", textContent: shortFingerprint(fingerprint) }),
];

const toggleRoot = fingerprint => {
    // Selecting text (e.g. to copy the fingerprint) also fires a click.
    if (window.getSelection().toString()) return;
    expanded = toggled(expanded, fingerprint);
    render(current);
};

const rootItem = ([fingerprint, root], unlistedIn) => {
    const isOpen = expanded.has(fingerprint);
    return el("li", { className: "root", onclick: () => toggleRoot(fingerprint) },
        el("div", {
            className: "name",
            textContent: `${isOpen ? "▾" : "▸"} ${displayName(root.subject)}`,
        }),
        el("div", { className: "meta", textContent: rootMeta(root, unlistedIn) }),
        ...(isOpen ? [rootDetails(fingerprint, root)] : rootSummary(fingerprint, root)),
    );
};

const exceptionItem = ([host, exception]) => el("li", { title: exception.fingerprint ?? "" },
    el("div", { className: "name", textContent: host }),
    el("div", { className: "meta", textContent: exception.reasons.join(", ") }),
    el("div", { className: "meta", textContent: certLine(exception) }),
    el("div", {
        className: "meta",
        textContent: `${exception.requests} requests · last seen ${formatDate(exception.lastSeen)}`,
    }),
);

const section = (title, className, note, items) => items.length === 0
    ? undefined
    : el("section", { className },
        el("h4", { textContent: `${title} (${items.length})` }),
        note ? el("p", { className: "note", textContent: note }) : undefined,
        el("ul", {}, ...items));

const neverSeenItem = mozillaRoot => el("li", { title: mozillaRoot.sha256 },
    el("div", { textContent: mozillaRoot.name }),
    el("div", { className: "meta", textContent: mozillaRootMeta(mozillaRoot) }),
);

const statsSection = stats => stats === undefined
    ? undefined
    : el("details", {
        className: "stats",
        open: statsOpen,
        ontoggle: event => statsOpen = event.target.open,
    },
        el("summary", { textContent: "Stats" }),
        ...statsLines(stats).map(line => el("div", { textContent: line })),
        el("div", { className: "label stats-heading", textContent: "By CA operator" }),
        ...operatorLines(stats).map(line => el("div", { textContent: line })),
    );

const neverSeenSection = (neverSeen, fetched) => neverSeen.length === 0
    ? undefined
    : el("details", {
        className: "never-seen",
        open: neverSeenOpen,
        ontoggle: event => neverSeenOpen = event.target.open,
    },
        el("summary", { textContent: `Never seen (${neverSeen.length})` }),
        el("p", {
            className: "note",
            textContent: `Website roots from Mozilla's list (CCADB, fetched ${fetched}) ` +
                "that no site used yet. Grouped like Firefox's Certificate Manager.",
        }),
        ...Object.entries(Object.groupBy(neverSeen, organizationOf))
            .sort(([a], [b]) => a.localeCompare(b))
            .flatMap(([organization, group]) => [
                el("div", { className: "org", textContent: `${organization} (${group.length})` }),
                el("ul", {}, ...group.map(neverSeenItem)),
            ]),
    );

const summaryText = (entries, notBuiltIn, exceptionEntries, comparison) => {
    if (entries.length === 0 && exceptionEntries.length === 0) return "No root CAs stored yet.";
    const counts = `${entries.length} roots seen · ${notBuiltIn.length} not built in · ` +
        `${exceptionEntries.length} certificate exceptions`;
    if (!comparison) return counts;
    const { seenCount, total } = comparison;
    return `Seen ${seenCount} of Mozilla's ${total} website roots ` +
        `(${percent(seenCount, total)}%)\n${counts}`;
};

const renderListStatus = mozilla => {
    if (!mozilla) {
        listAge.textContent = "Mozilla root list not available";
        listStatus.classList.remove("stale");
        return;
    }
    const days = ageInDays(mozilla.fetched, Date.now());
    listAge.textContent = `Mozilla list from ${mozilla.fetched} (${ageText(days)})`;
    listStatus.classList.toggle("stale", days > STALE_AFTER_DAYS);
};

const render = ({ roots, exceptions, mozilla }) => {
    const entries = Object.entries(roots).sort(byRequests);
    const notBuiltIn = entries.filter(([, r]) => r.isBuiltInRoot === false);
    const builtIn = entries.filter(([, r]) => r.isBuiltInRoot !== false);
    const exceptionEntries = Object.entries(exceptions)
        .sort(([, a], [, b]) => b.lastSeen - a.lastSeen);
    const comparison = mozilla ? compareWithMozilla(roots, mozilla.roots) : undefined;
    // The list's date, if a seen built-in root is missing from it.
    const unlistedIn = ([fingerprint]) =>
        comparison !== undefined && !comparison.listed.has(normalizeFingerprint(fingerprint))
            ? mozilla.fetched
            : undefined;

    summary.textContent = summaryText(entries, notBuiltIn, exceptionEntries, comparison);
    renderListStatus(mozilla);

    content.replaceChildren(...[
        statsSection(computeStats(roots, exceptions, mozilla?.roots)),
        section("Not built-in roots", "warn",
            "Installed by you or by software (corporate proxy, antivirus, dev tools). " +
            "Can mean your HTTPS traffic is being inspected.",
            notBuiltIn.map(entry => rootItem(entry, undefined))),
        section("Certificate exceptions", "caution",
            "Sites that only load because an exception was accepted. " +
            "All exceptions: Settings → Certificates → View Certificates → Servers.",
            exceptionEntries.map(exceptionItem)),
        section("Built-in roots", "", undefined,
            builtIn.map(entry => rootItem(entry, unlistedIn(entry)))),
        comparison ? neverSeenSection(comparison.neverSeen, mozilla.fetched) : undefined,
    ].filter(Boolean));
};

const load = changes => {
    current = { ...current, ...changes };
    render(current);
};

// Bundled with the extension; a missing or broken file only hides the
// Mozilla comparison until the list is updated. Loaded once per popup.
const bundledMozillaRoots = fetch(browser.runtime.getURL("mozilla-roots.json"))
    .then(response => response.json())
    .catch(err => {
        console.error("Loading mozilla-roots.json failed:", err);
        return null;
    });

// Always reads the full current state, so a storage change arriving while
// the first read is still pending can't be overwritten by older data.
const refresh = () => Promise.all([
    browser.storage.local.get(["roots", "exceptions", "mozillaRoots"]),
    bundledMozillaRoots,
]).then(([{ roots, exceptions, mozillaRoots }, bundled]) => load({
    roots: roots ?? {},
    exceptions: exceptions ?? {},
    mozilla: newerList(bundled, mozillaRoots),
}));

// Shows a temporary label on a button, then restores the original one. A new
// flash cancels the previous one's restore.
const flashTimers = new Map();
const flash = (button, label) => {
    clearTimeout(flashTimers.get(button));
    const original = button.dataset.label ?? button.textContent;
    button.dataset.label = original;
    button.textContent = label;
    flashTimers.set(button, setTimeout(() => button.textContent = original, 1500));
};

// Firefox lets users withdraw the "all websites" access in about:addons.
// Without it no request is visible and nothing gets recorded.
const ALL_SITES = { origins: ["<all_urls>"] };
const checkPermission = async () => {
    permissionBanner.hidden = await browser.permissions.contains(ALL_SITES);
};

// Use up to 90% of the browser window's height. Firefox clips popups at
// 600px, so the CSS max-height stays the upper bound. browser.windows
// doesn't exist on Android, where the popup is a full page anyway.
const POPUP_HEIGHT_SHARE = 0.9;
const fitHeight = async () => {
    const win = await browser.windows?.getCurrent();
    if (!win?.height) return;
    document.body.style.maxHeight = `${Math.min(600, Math.round(win.height * POPUP_HEIGHT_SHARE))}px`;
};

// --- Wiring ---

fitHeight();
refresh();
checkPermission();

// Keep the popup live while browsing in the background.
browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(changes.roots || changes.exceptions || changes.mozillaRoots)) return;
    refresh();
});

// permissions.request must run directly in the click handler.
grantBtn.addEventListener("click", () =>
    browser.permissions.request(ALL_SITES).then(checkPermission));

// The background does the download, so it finishes even if the popup closes.
// The new list arrives through storage.onChanged above.
const requestListUpdate = () =>
    browser.runtime.sendMessage("updateMozillaRoots")
        .catch(err => ({ ok: false, error: err.message }));

updateListBtn.addEventListener("click", async () => {
    updateListBtn.disabled = true;
    updateListBtn.textContent = "Updating…";
    const result = await requestListUpdate();
    updateListBtn.disabled = false;
    updateListBtn.textContent = "Update list";
    flash(updateListBtn, result?.ok ? `Updated: ${result.count} roots` : "Update failed");
    listAge.title = result?.ok ? "" : result?.error ?? "";
});

copyBtn.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(exportText(current));
        flash(copyBtn, "Copied!");
    } catch (err) {
        console.error("Copy failed:", err);
        flash(copyBtn, "Copy failed");
    }
});

// confirm() doesn't work in Firefox extension popups, so reset takes two
// clicks: the first arms the button, the second (within the timeout) resets.
let confirmTimer;
resetBtn.addEventListener("click", async () => {
    if (!confirmTimer) {
        resetBtn.textContent = "Click again to reset";
        confirmTimer = setTimeout(() => {
            confirmTimer = undefined;
            resetBtn.textContent = "Reset seen";
        }, CONFIRM_TIMEOUT_MS);
        return;
    }

    clearTimeout(confirmTimer);
    confirmTimer = undefined;
    resetBtn.textContent = "Reset seen";
    // The background owns the stored state; it clears memory and storage together.
    await browser.runtime.sendMessage("resetRootCAs");
});
