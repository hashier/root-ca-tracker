const seenSubjects = new Set();

// Load saved list from storage
browser.storage.local.get("rootCAs").then(data => {
    if (data.rootCAs && Array.isArray(data.rootCAs)) {
        data.rootCAs.forEach(subject => seenSubjects.add(subject));
    }
});

browser.runtime.onMessage.addListener((message) => {
    if (message === "printRootCAs") {
        printRootCAs();
    } else if (message === "resetRootCAs") {
        seenSubjects.clear();
        console.log("seenSubjects reset.");
    }
});

browser.webRequest.onHeadersReceived.addListener(
    logRootCA,
    { urls: ["<all_urls>"] },
    ["blocking"]
    // ["responseHeaders"]
);

function printRootCAs() {
    browser.storage.local.get("rootCAs").then(({ rootCAs }) => {
        if (!rootCAs || rootCAs.length === 0) {
            console.log("No root CAs stored yet.");
            return;
        }
        console.log(`Stored Root CAs (${rootCAs.length}):`);
        rootCAs.forEach((subject, i) => console.log(`${i + 1}. ${subject}`));
    });
}

async function logRootCA(details) {
    try {
        const info = await browser.webRequest.getSecurityInfo(details.requestId, {
            certificateChain: true,
            rawDER: false
        });

        if (!info || !info.certificates || info.certificates.length === 0) {
            return;
        }

        const rootCert = info.certificates[info.certificates.length - 1];
        const subject = rootCert.issuer;

        if (!seenSubjects.has(subject)) {
            seenSubjects.add(subject);
            console.log(`${details.url} caused a new root CA to be seen: ${subject}`);

            // Update storage
            browser.storage.local.set({
                rootCAs: Array.from(seenSubjects)
            });
        } else {
            console.debug(`Root CA Already Seen: ${subject}`);
        }
    } catch (err) {
        console.error("Error: getSecurityInfo error:", err);
    }
}
