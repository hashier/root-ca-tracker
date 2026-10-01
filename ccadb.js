// Parses CCADB's report of roots included in Firefox. Shared by the
// extension (Update list button) and scripts/update-mozilla-roots.js
// (refreshing the bundled mozilla-roots.json).

const CCADB_SOURCE = "https://ccadb.my.salesforce-sites.com/mozilla/IncludedCACertificateReportPEMCSV";

const REQUIRED_COLUMNS = [
    "SHA-256 Fingerprint",
    "Common Name or Certificate Name",
    "Certificate Issuer Organization",
    "Owner",
    "Trust Bits",
    "Valid To [GMT]",
    "Distrust for TLS After Date",
];

// RFC 4180: quoted fields may contain commas, doubled quotes and line
// breaks (the PEM column does). Returns an array of rows of strings.
const parseCsv = text => {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (char === '"') quoted = false;
            else field += char;
        } else if (char === '"') quoted = true;
        else if (char === ",") { row.push(field); field = ""; }
        else if (char === "\n" || char === "\r") {
            if (char === "\r" && text[i + 1] === "\n") i++;
            row.push(field); rows.push(row); row = []; field = "";
        } else field += char;
    }
    if (field !== "" || row.length > 0) rows.push([...row, field]);
    return rows;
};

// CCADB writes dates as "2030.09.22"; empty when not set.
const isoDate = value => value.replaceAll(".", "-") || null;

const toRoot = row => ({
    sha256: row["SHA-256 Fingerprint"].toUpperCase(),
    name: row["Common Name or Certificate Name"],
    // Matches the subject O=, which is how Firefox's Certificate Manager
    // groups roots.
    organization: row["Certificate Issuer Organization"],
    owner: row["Owner"],
    validTo: isoDate(row["Valid To [GMT]"]),
    distrustTlsAfter: isoDate(row["Distrust for TLS After Date"]),
});

// Only roots trusted for websites; email-only roots never show up in TLS.
// Throws if the format changed, so callers keep their previous list.
const websiteRoots = csvText => {
    const [header, ...records] = parseCsv(csvText.replace(/^﻿/, ""));
    const missing = REQUIRED_COLUMNS.filter(column => !header?.includes(column));
    if (missing.length > 0) throw new Error(`CCADB format changed, missing: ${missing.join(", ")}`);

    const roots = records
        .filter(values => values.length === header.length)
        .map(values => Object.fromEntries(header.map((column, i) => [column, values[i]])))
        .filter(row => row["Trust Bits"].split(";").includes("Websites"))
        .map(toRoot)
        .sort((a, b) => a.organization.localeCompare(b.organization) || a.name.localeCompare(b.name));
    if (roots.length === 0) throw new Error("CCADB report contains no website roots");
    return roots;
};

const fetchMozillaRoots = async (today = new Date()) => {
    const response = await fetch(CCADB_SOURCE);
    if (!response.ok) throw new Error(`CCADB download failed: HTTP ${response.status}`);
    return {
        source: CCADB_SOURCE,
        fetched: today.toISOString().slice(0, 10),
        roots: websiteRoots(await response.text()),
    };
};

// Loaded as a plain script in the extension, required as a module in Node.
if (typeof module !== "undefined") {
    module.exports = { parseCsv, websiteRoots, fetchMozillaRoots };
}
