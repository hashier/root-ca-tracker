const certList = document.getElementById("cert-list");
const copyBtn = document.getElementById("copy");
const resetBtn = document.getElementById("reset");

// Load stored certs
browser.storage.local.get("rootCAs").then(({ rootCAs }) => {
    if (!rootCAs || rootCAs.length === 0) {
        certList.textContent = "No root CAs stored yet.";
        return;
    }

    sorted = rootCAs
        .slice() // avoid mutating original array
        .sort()  // sort alphabetically
        .map((ca, i, arr) => {
            const number = (i + 1).toString().padStart(arr.length.toString().length, " ");
            return `${number}. ${ca}`;
        })
        .join("\n");
    certList.textContent = sorted
});

// Copy to clipboard
copyBtn.addEventListener("click", async () => {
    const text = certList.textContent;
    try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "Copied!";
        setTimeout(() => copyBtn.textContent = "Copy", 1500);
    } catch (err) {
        alert("Failed to copy: " + err);
    }
});

// Reset list
resetBtn.addEventListener("click", () => {
    if (!confirm("Clear all stored Root CAs?")) return;

    browser.storage.local.set({ rootCAs: [] }).then(() => {
        certList.textContent = "No root CAs stored yet.";

        // Tell background to clear Set too
        browser.runtime.sendMessage("resetRootCAs");
    });
});
