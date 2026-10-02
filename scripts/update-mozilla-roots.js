// Refreshes the bundled mozilla-roots.json from CCADB. Run from the repo root
// with `make roots`, or `node scripts/update-mozilla-roots.js`.

const fs = require("fs");
const path = require("path");
const { fetchMozillaRoots } = require("../ccadb.js");

const OUTPUT = path.join(__dirname, "..", "mozilla-roots.json");

fetchMozillaRoots()
    .then(list => {
        fs.writeFileSync(OUTPUT, JSON.stringify(list, null, 1) + "\n");
        console.log(`Wrote ${list.roots.length} roots to ${OUTPUT}`);
    })
    .catch(err => {
        console.error(err.message);
        process.exit(1);
    });
