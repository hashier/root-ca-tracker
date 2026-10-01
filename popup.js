const certList = document.getElementById("cert-list");
const copyBtn = document.getElementById("copy");
const resetBtn = document.getElementById("reset");

const EMPTY_TEXT = "No root CAs stored yet.";
const CONFIRM_TIMEOUT_MS = 3000;

const formatList = subjects => {
    const width = subjects.length.toString().length;
    return subjects
        .map((subject, i) => `${(i + 1).toString().padStart(width, " ")}. ${subject}`)
        .join("\n");
};

const render = roots => {
    const subjects = Object.values(roots ?? {}).map(r => r.subject).sort();
    certList.textContent = subjects.length === 0 ? EMPTY_TEXT : formatList(subjects);
};

// Shows a temporary label on a button, then restores the original one.
const flash = (button, label) => {
    const original = button.dataset.label ?? button.textContent;
    button.dataset.label = original;
    button.textContent = label;
    setTimeout(() => button.textContent = original, 1500);
};

browser.storage.local.get("roots").then(({ roots }) => render(roots));

copyBtn.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(certList.textContent);
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
    // The background owns the stored list; it clears memory and storage together.
    await browser.runtime.sendMessage("resetRootCAs");
    render({});
});
