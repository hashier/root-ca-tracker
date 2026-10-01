// Stored state:
//
// roots: { [sha256]: { subject, isBuiltInRoot, validUntil,
//                      firstSeen, lastSeen, requests, hosts } }
//   Roots from the store that Firefox built a chain to. Keyed by SHA-256
//   fingerprint because subject names are not unique.
//
// exceptions: { [host]: { subject, issuer, fingerprint, reasons,
//                         firstSeen, lastSeen, requests } }
//   Hosts whose certificate Firefox flagged (untrusted, wrong name, expired)
//   but which loaded anyway, so a certificate exception must exist for them.
//
// The pre-fingerprint "rootCAs" key (issuer names only) is left untouched.
const MAX_HOSTS = 5;

// Every HTTPS request updates counters, so writes are batched. Up to this
// much activity can be lost if Firefox quits right after a request.
const FLUSH_DELAY_MS = 2000;

// The background is a non-persistent event page: it can be unloaded and
// started again by the next request. Every handler awaits this before
// touching `state`, so a request arriving during startup can't be counted
// against an empty state and then overwrite the stored one.
let state = { roots: {}, exceptions: {} };
const ready = browser.storage.local.get(["roots", "exceptions"]).then(data => {
    state = { roots: data.roots ?? {}, exceptions: data.exceptions ?? {} };
});

const counted = (previous, now) => ({
    firstSeen: previous?.firstSeen ?? now,
    lastSeen: now,
    requests: (previous?.requests ?? 0) + 1,
});

// Most recent first, without duplicates.
const withRecentHost = (hosts = [], host) =>
    [host, ...hosts.filter(h => h !== host)].slice(0, MAX_HOSTS);

const withRootHit = (roots, cert, host, now) => {
    const fingerprint = cert.fingerprint.sha256;
    const previous = roots[fingerprint];
    return {
        ...roots,
        [fingerprint]: {
            ...counted(previous, now),
            subject: cert.subject,
            isBuiltInRoot: cert.isBuiltInRoot,
            validUntil: cert.validity.end,
            hosts: withRecentHost(previous?.hosts, host),
        },
    };
};

const withExceptionHit = (exceptions, host, serverCert, reasons, now) => ({
    ...exceptions,
    [host]: {
        ...counted(exceptions[host], now),
        subject: serverCert?.subject,
        issuer: serverCert?.issuer,
        fingerprint: serverCert?.fingerprint.sha256,
        reasons,
    },
});

// The last certificate of a chain is only a root if Firefox could build a
// path to a trusted anchor. For untrusted chains it's whatever the server sent.
const rootOf = info =>
    info.isUntrusted ? undefined : info.certificates?.at(-1);

// Any of these means the page only loaded because of a certificate exception.
// Domain mismatch and expiry can happen on chains to a trusted root, so a
// connection can produce both a root and an exception.
const exceptionReasons = info => [
    ["untrusted issuer", info.isUntrusted],
    ["domain mismatch", info.isDomainMismatch],
    ["expired or not yet valid", info.isNotValidAtThisTime],
].filter(([, flagged]) => flagged).map(([reason]) => reason);

let flushTimer;
const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = undefined;
        browser.storage.local.set(state).catch(err =>
            console.error("Error: storing state failed:", err));
    }, FLUSH_DELAY_MS);
};

async function recordSighting(url, info) {
    await ready;
    const host = new URL(url).host;
    const now = Date.now();
    const root = rootOf(info);
    const reasons = exceptionReasons(info);
    if (!root && reasons.length === 0) return;

    if (root && !state.roots[root.fingerprint.sha256]) {
        console.log(`${url} caused a new root CA to be seen: ${root.subject}`);
    }
    state = {
        roots: root ? withRootHit(state.roots, root, host, now) : state.roots,
        exceptions: reasons.length > 0
            ? withExceptionHit(state.exceptions, host, info.certificates?.[0], reasons, now)
            : state.exceptions,
    };
    scheduleFlush();
}

async function resetAll() {
    await ready;
    state = { roots: {}, exceptions: {} };
    await browser.storage.local.set(state);
}

async function printRoots() {
    await ready;
    const subjects = Object.values(state.roots).map(r => r.subject).sort();
    if (subjects.length === 0) {
        console.log("No root CAs stored yet.");
        return;
    }
    console.log(`Stored Root CAs (${subjects.length}):`);
    subjects.forEach((subject, i) => console.log(`${i + 1}. ${subject}`));
}

const messageHandlers = {
    printRootCAs: printRoots,
    resetRootCAs: resetAll,
};

browser.runtime.onMessage.addListener(message => messageHandlers[message]?.());

// getSecurityInfo only works while the request is blocked in
// onHeadersReceived, so the listener must be blocking. It returns once the
// security info is read; recording happens without holding up the request.
browser.webRequest.onHeadersReceived.addListener(
    async details => {
        try {
            const info = await browser.webRequest.getSecurityInfo(details.requestId, {
                certificateChain: true,
                rawDER: false,
            });
            if (!info) return;
            recordSighting(details.url, info).catch(err =>
                console.error("Error: recording sighting failed:", err));
        } catch (err) {
            console.error("Error: getSecurityInfo error:", err);
        }
    },
    { urls: ["https://*/*", "wss://*/*"] },
    ["blocking"]
);
