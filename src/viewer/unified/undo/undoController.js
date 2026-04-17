function describeOp(op) {
    const id = op.sidNew || op.sidOld || "(no id)";
    if (op.type === "insert") return `Insert ${id}`;
    if (op.type === "delete") return `Delete ${id}`;
    if (op.type === "move") return `Move ${id}`;
    if (op.type === "update") return `Update ${id}`;
    if (op.type === "moveupdate") return `Move + update ${id}`;
    return `${op.type} ${id}`;
}

function scoreOpForClickedId(op, clickedId) {
    let score = 0;
    if (!clickedId || !op) return score;

    if (op.sidNew === clickedId) score += 10;
    if (op.sidOld === clickedId) score += 10;
    if (op.id === clickedId) score += 8;
    if (op.selfOldId === clickedId) score += 6;
    if (op.mergeOwnerId === clickedId) score += 4;

    if ((op.subtreeIdsOld || []).includes(clickedId)) score += 2;
    if ((op.subtreeIdsNew || []).includes(clickedId)) score += 2;

    return score;
}

function esc(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function renderXmlBlock(label, xml) {
    if (!xml) {
        return `
            <div style="margin-top:6px;">
                <div style="font-weight:600;">${label}</div>
                <div style="font-size:12px; color:#888;"><em>not available</em></div>
            </div>
        `;
    }

    return `
        <div style="margin-top:6px;">
            <div style="font-weight:600;">${label}</div>
            <pre style="margin:4px 0 0; padding:8px; background:#f7f7f7; border:1px solid #eee; border-radius:6px; overflow:auto; font-size:12px; white-space:pre-wrap;">${esc(xml)}</pre>
        </div>
    `;
}

function expandUndoOps(op) {
    if (!op) return [];

    if (op.type === "moveupdate") {
        if (op.updateOp && op.moveOp) {
            return [op.updateOp, op.moveOp];
        }

        return [
            { ...op, type: "update" },
            { ...op, type: "move" }
        ];
    }

    return [op];
}

export function installUndoController() {
    const pop = document.getElementById("undo-popover");
    const body = document.getElementById("undo-popover-body");
    const undoBtn = document.getElementById("undo-btn");
    const cancelBtn = document.getElementById("undo-cancel-btn");

    const state = {
        selectedPayload: null,
        selectedOp: null,
    };

    function hide() {
        if (pop) pop.hidden = true;
        state.selectedPayload = null;
        state.selectedOp = null;
        if (body) body.innerHTML = "";
    }

    function showForPayload(payload) {
        if (!payload?.updates?.length || !pop || !body) {
            hide();
            return;
        }

        state.selectedPayload = payload;

        // simplest for now: pick first op
        state.selectedOp = [...payload.updates]
            .sort((a, b) => scoreOpForClickedId(b, payload.clickedId) - scoreOpForClickedId(a, payload.clickedId))[0];

        const opsHtml = payload.updates.map((op, idx) => {
            const selected = idx === 0 ? " <strong>(selected)</strong>" : "";
            return `
        <div style="margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid #eee;">
            <div><strong>${describeOp(op)}</strong></div>
       
        </div>
    `;
        }).join("");

        body.innerHTML = opsHtml;
        pop.hidden = false;
    }

    window.addEventListener("diff-element-click", (e) => {
        showForPayload(e.detail);
    });
    window.addEventListener("diff-element-empty-click", () => {
        hide();
    });

    window.addEventListener("message", (e) => {
        const msg = e.data;
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "DIFF_ELEMENT_CLICK") {
            showForPayload(msg.payload);
        }

        if (msg.type === "UNDO_APPLIED") {
            hide();
        }
    });
    undoBtn?.addEventListener("click", () => {
        if (!state.selectedOp) return;

        const msg = {
            type: "UNDO_REQUEST",
            ops: expandUndoOps(state.selectedOp)
        };

        console.log("UNDO sending request", msg);
        window.parent?.postMessage(msg, "*");
        window.dispatchEvent(new CustomEvent("undo-request", { detail: msg }));
    });

    cancelBtn?.addEventListener("click", hide);

    return { hide, showForPayload };
}