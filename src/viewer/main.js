import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {computeDiffState} from "./computeDiffState.js";

const args = new Map(
    process.argv.slice(2).map((a) => {
        const [k, v] = a.split("=");
        return [k.replace(/^--/, "").toLowerCase(), v ?? ""];
    })
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALGO = (args.get("algo") ?? "cpeediff").toLowerCase();

const OLD = args.get("old") ?? "./testset/visualize_one_premove.xml";
const NEW = args.get("new") ?? "./testset/visualize_one_2ins_1del_1mov.xml";

const rawPassthrough =
    (args.get("raw") ?? "").toLowerCase() === "true" || args.has("raw");

const oldPath = path.resolve(__dirname, OLD);
const newPath = path.resolve(__dirname, NEW);

const requested = (args.get("anchors") ?? "all")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const ALL = ["id", "endpoint", "label"];
const anchors =
    requested.length === 1 && requested[0] === "all" ? ALL : requested;

const mode = args.get("mode") ?? "balanced";
const pretty = (args.get("pretty") ?? "true") !== "false";

function writeViewerData({
                             oldTreeXml,
                             newTreeXml,
                             diffSource,
                             diffOps,
                             rawDiffXml = null
                         }) {
    const out = `
window.OLD_TREE = ${JSON.stringify(oldTreeXml)};
window.NEW_TREE = ${JSON.stringify(newTreeXml)};
window.DIFF_SOURCE = ${JSON.stringify(diffSource)};
window.DIFF_ANCHORS = ${JSON.stringify(anchors)};
window.DIFF_MODE = ${JSON.stringify(mode)};
window.DIFF = ${JSON.stringify(diffOps ?? [])};
window.RAW_DIFF_XML = ${JSON.stringify(rawDiffXml)};
`;

    fs.writeFileSync(path.resolve(__dirname, "diff_data.js"), out, "utf8");
}

(async () => {
    try {
        const result = await computeDiffState({
            algo: ALGO,
            oldFilePath: oldPath,
            newFilePath: newPath,
            rawPassthrough,
            anchors,
            mode,
            pretty,
            xydiffBinaryPath: path.resolve(__dirname, "../../xydiff-bin/xydiff")
        });

        // optional for local viewer debugging
        if ((args.get("viewer") ?? "true") !== "false") {
            writeViewerData(result);
        }

        if (result.rawDiffXml) {
            console.log(result.rawDiffXml);
        } else {
            console.log(JSON.stringify(result.diffOps, null, 2));
        }
    } catch (err) {
        console.error("Diff failed:", err?.message ?? err);
        process.exitCode = 1;
    }
})();