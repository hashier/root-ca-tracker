const summary = document.getElementById("summary");
const content = document.getElementById("content");
const copyBtn = document.getElementById("copy");
const resetBtn = document.getElementById("reset");

const CONFIRM_TIMEOUT_MS = 3000;

// Latest stored data, used by Copy.
let current = { roots: {}, exceptions: {} };

// Fingerprints of roots whose details are open. Kept here so live
// re-renders don't collapse them.
let expanded = new Set();

// --- Formatting (pure) ---

// "CN=ISRG Root X1,O=Internet Security Research Group,C=US" -> "ISRG Root X1".
// Falls back to O=, then the full subject, for roots without a CN.
const displayName = subject => {
    const field = key => subject?.match(new RegExp(`(?:^|,)${key}=([^,]+)`))?.[1];
    return field("CN") ?? field("O") ?? subject ?? "(unknown)";
};

const formatDate = ms => (ms ? new Date(ms).toISOString().slice(0, 10) : "?");

// Enough of the fingerprint to tell same-name roots apart.
const shortFingerprint = fp => (fp ? `${fp.slice(0, 23)}…` : "");

// crt.sh accepts a SHA-256 fingerprint as hex without separators.
const crtShUrl = fingerprint => `https://crt.sh/?q=${fingerprint.replaceAll(":", "")}`;

const toggled = (set, key) =>
    set.has(key) ? new Set([...set].filter(k => k !== key)) : new Set([...set, key]);

const byName = ([, a], [, b]) => displayName(a.subject).localeCompare(displayName(b.subject));

// Entries recorded before these fields existed lack them until seen again.
const rootMeta = root => [
    root.requests ? `${root.requests} requests` : undefined,
    root.lastSeen ? `last seen ${formatDate(root.lastSeen)}` : undefined,
    root.validUntil ? `valid until ${formatDate(root.validUntil)}` : undefined,
].filter(Boolean).join(" · ");

// Firefox returns no certificates for untrusted chains, so most exceptions
// have no subject or issuer.
const certLine = exception => exception.subject
    ? `cert: ${displayName(exception.subject)} · issued by ${displayName(exception.issuer)}`
    : "certificate details not available";

const exportText = ({ roots, exceptions }) => {
    const rootLines = Object.entries(roots).sort(byName).map(([fp, r]) =>
        `${r.isBuiltInRoot === false ? "[NOT BUILT-IN] " : ""}${r.subject}  ${fp}`);
    const exceptionLines = Object.entries(exceptions).map(([host, e]) =>
        `${host}  (${e.reasons.join(", ")})  ${e.subject ?? "-"}`);
    return [
        `Root CAs (${rootLines.length}):`, ...rootLines,
        "",
        `Certificate exceptions (${exceptionLines.length}):`, ...exceptionLines,
    ].join("\n");
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

const rootItem = ([fingerprint, root]) => {
    const isOpen = expanded.has(fingerprint);
    return el("li", { className: "root", onclick: () => toggleRoot(fingerprint) },
        el("div", {
            className: "name",
            textContent: `${isOpen ? "▾" : "▸"} ${displayName(root.subject)}`,
        }),
        el("div", { className: "meta", textContent: rootMeta(root) }),
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

const render = ({ roots, exceptions }) => {
    const entries = Object.entries(roots).sort(byName);
    const notBuiltIn = entries.filter(([, r]) => r.isBuiltInRoot === false);
    const builtIn = entries.filter(([, r]) => r.isBuiltInRoot !== false);
    const exceptionEntries = Object.entries(exceptions)
        .sort(([, a], [, b]) => b.lastSeen - a.lastSeen);

    summary.textContent = entries.length === 0 && exceptionEntries.length === 0
        ? "No root CAs stored yet."
        : `${entries.length} roots seen · ${notBuiltIn.length} not built in · ` +
          `${exceptionEntries.length} certificate exceptions`;

    content.replaceChildren(...[
        section("Not built-in roots", "warn",
            "Installed by you or by software (corporate proxy, antivirus, dev tools). " +
            "Can mean your HTTPS traffic is being inspected.",
            notBuiltIn.map(rootItem)),
        section("Certificate exceptions", "caution",
            "Sites that only load because an exception was accepted. " +
            "All exceptions: Settings → Certificates → View Certificates → Servers.",
            exceptionEntries.map(exceptionItem)),
        section("Built-in roots", "", undefined, builtIn.map(rootItem)),
    ].filter(Boolean));
};

const load = ({ roots, exceptions }) => {
    current = { roots: roots ?? {}, exceptions: exceptions ?? {} };
    render(current);
};

// Shows a temporary label on a button, then restores the original one.
const flash = (button, label) => {
    const original = button.dataset.label ?? button.textContent;
    button.dataset.label = original;
    button.textContent = label;
    setTimeout(() => button.textContent = original, 1500);
};

// --- Wiring ---

browser.storage.local.get(["roots", "exceptions"]).then(load);

// Keep the popup live while browsing in the background.
browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(changes.roots || changes.exceptions)) return;
    load({
        roots: changes.roots ? changes.roots.newValue : current.roots,
        exceptions: changes.exceptions ? changes.exceptions.newValue : current.exceptions,
    });
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
            resetBtn.textContent = "Reset";
        }, CONFIRM_TIMEOUT_MS);
        return;
    }

    clearTimeout(confirmTimer);
    confirmTimer = undefined;
    resetBtn.textContent = "Reset";
    // The background owns the stored state; it clears memory and storage together.
    await browser.runtime.sendMessage("resetRootCAs");
});
