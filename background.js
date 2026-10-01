// Seen roots keyed by SHA-256 fingerprint: { [sha256]: { subject } }.
// Subject names are not unique (re-issued and cross-signed roots share them),
// the fingerprint is.
//
// Stored under "roots". The pre-fingerprint "rootCAs" key (issuer names only)
// is left untouched so no old data is lost.
const STORAGE_KEY = "roots";

// The background is a non-persistent event page: it can be unloaded and
// started again by the next request. Every handler awaits this before
// touching `roots`, so a request arriving during startup can't be counted
// against an empty set and then overwrite the stored one.
let roots = {};
const ready = browser.storage.local.get(STORAGE_KEY).then(data => {
    roots = data[STORAGE_KEY] ?? {};
});

const withRoot = (current, fingerprint, subject) =>
    current[fingerprint] ? current : { ...current, [fingerprint]: { subject } };

// The last certificate of a chain is only a root if Firefox could build a
// path to a trusted anchor. For untrusted chains it's whatever the server sent.
const rootOf = info =>
    info?.isUntrusted ? undefined : info?.certificates?.at(-1);

async function recordRoot(url, rootCert) {
    await ready;
    const fingerprint = rootCert.fingerprint.sha256;
    const updated = withRoot(roots, fingerprint, rootCert.subject);
    if (updated === roots) return;

    roots = updated;
    console.log(`${url} caused a new root CA to be seen: ${rootCert.subject}`);
    await browser.storage.local.set({ [STORAGE_KEY]: roots });
}

async function resetRoots() {
    await ready;
    roots = {};
    await browser.storage.local.set({ [STORAGE_KEY]: roots });
}

async function printRoots() {
    await ready;
    const subjects = Object.values(roots).map(r => r.subject).sort();
    if (subjects.length === 0) {
        console.log("No root CAs stored yet.");
        return;
    }
    console.log(`Stored Root CAs (${subjects.length}):`);
    subjects.forEach((subject, i) => console.log(`${i + 1}. ${subject}`));
}

const messageHandlers = {
    printRootCAs: printRoots,
    resetRootCAs: resetRoots,
};

browser.runtime.onMessage.addListener(message => messageHandlers[message]?.());

// getSecurityInfo only works while the request is blocked in
// onHeadersReceived, so the listener must be blocking. It returns once the
// security info is read; persisting happens without holding up the request.
browser.webRequest.onHeadersReceived.addListener(
    async details => {
        try {
            const info = await browser.webRequest.getSecurityInfo(details.requestId, {
                certificateChain: true,
                rawDER: false,
            });
            const rootCert = rootOf(info);
            if (!rootCert) return;
            recordRoot(details.url, rootCert).catch(err =>
                console.error("Error: storing root CA failed:", err));
        } catch (err) {
            console.error("Error: getSecurityInfo error:", err);
        }
    },
    { urls: ["https://*/*", "wss://*/*"] },
    ["blocking"]
);
