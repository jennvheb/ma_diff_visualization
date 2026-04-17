import {reverseOperations} from "./undo/reverseOperation.js";

async function recomputeDiffOnHost({ oldXml, newXml }) {
    let resp;
    try {
        resp = await fetch("http://localhost:8787/api/recompute-diff", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                algo: window.DIFF_SOURCE || "cpeediff",
                oldXml,
                newXml,
                anchors: window.DIFF_ANCHORS || ["id", "endpoint", "label"],
                mode: window.DIFF_MODE || "balanced",
                rawPassthrough: false
            })
        });
    } catch (err) {
        console.error("[mockHostUndo] network/CORS fetch error", err);
        throw err;
    }

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Recompute failed with HTTP ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    if (!json.ok) {
        throw new Error(json.error || "Unknown recompute error");
    }

    return json.result;
}

export function installMockHostUndo({ rerender }) {
    const state = {
        baselineOldXml: window.OLD_TREE || window.OLD,
        currentNewXml: window.NEW_TREE || window.NEW,
    };

    window.addEventListener("undo-request", async (e) => {
        const msg = e.detail;
        const ops = msg?.ops;
        if (!ops?.length) return;

        console.log("mock host received undo request json", JSON.stringify(ops, null, 2));

        try {
            const nextNewXml = reverseOperations({
                baselineOldXml: state.baselineOldXml,
                currentNewXml: state.currentNewXml,
                ops
            });

            const diffResult = await recomputeDiffOnHost({
                oldXml: state.baselineOldXml,
                newXml: nextNewXml
            });

            // advance host state to the recomputed canonical result
            state.currentNewXml = diffResult.newTreeXml;
            state.baselineOldXml = diffResult.oldTreeXml;

            window.NEW_TREE = diffResult.newTreeXml;
            window.OLD_TREE = diffResult.oldTreeXml;
            window.NEW = diffResult.newTreeXml;
            window.OLD = diffResult.oldTreeXml;
            window.DIFF = diffResult.diffOps || [];
            window.DIFF_SOURCE = diffResult.diffSource || window.DIFF_SOURCE;
            window.RAW_DIFF_XML = diffResult.rawDiffXml || null;

            window.postMessage({ type: "UNDO_APPLIED" }, "*");

            if (typeof rerender === "function") {
                await rerender({
                    oldXml: diffResult.oldTreeXml,
                    newXml: diffResult.newTreeXml,
                    diffOps: diffResult.diffOps,
                    diffSource: diffResult.diffSource
                });
            } else {
                console.warn("mock host rerender function missing");
            }
        } catch (err) {
            console.error("mock host undo failed", err);
            alert(`Undo failed: ${err.message}`);
        }
    });
}