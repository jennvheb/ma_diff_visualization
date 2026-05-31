function describeOp(op) {
    const id = op.sidNew || op.sidOld || "(no id)";
    if (op.type === "insert") return `Insert ${id}`;
    if (op.type === "delete") return `Delete ${id}`;
    if (op.type === "move") return `Move ${id}`;
    if (op.type === "update") return `Update ${id}`;
    if (op.type === "moveupdate") return `Move + update ${id}`;
    return `${op.type} ${id}`;
}

function undoKey(op) {
    const oldP = op.rebasedOldPath || op.oldPath || "";
    const newP = op.rebasedNewPath || op.newPath || "";
    const id = op.sidOld || op.sidNew || op.selfOldId || op.id || "";

    return `${op.type}|${id}|${oldP}|${newP}`;
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



function sameLogicalNode(a, b) {
    if (!a || !b) return false;

    const aIds = [
        a.id,
        a.sidOld,
        a.sidNew,
        a.selfOldId,
        a.mergeOwnerId
    ].filter(Boolean);

    const bIds = [
        b.id,
        b.sidOld,
        b.sidNew,
        b.selfOldId,
        b.mergeOwnerId
    ].filter(Boolean);

    return aIds.some(id => bIds.includes(id));
}

function intersects(a = [], b = []) {
    const set = new Set((a || []).filter(Boolean));
    return (b || []).some(x => x && set.has(x));
}

function findReplacementPair(op, allOps = []) {
    if (!op) return null;

    const oppositeType =
        op.type === "delete" ? "insert" :
            op.type === "insert" ? "delete" :
                null;

    if (!oppositeType) return null;

    return allOps.find(other => {
        if (other === op || other.type !== oppositeType) return false;

        return (
            sameLogicalNode(op, other) ||
            intersects(op.subtreeIdsOld, other.subtreeIdsNew) ||
            intersects(op.subtreeIdsNew, other.subtreeIdsOld)
        );
    }) || null;
}

function expandUndoOps(op, allOps = []) {
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

    const pair = findReplacementPair(op, allOps);

    if (pair) {
        const insertOp = op.type === "insert" ? op : pair;
        const deleteOp = op.type === "delete" ? op : pair;

        return [insertOp, deleteOp];
    }

    return [op];
}


function toUndoPayloadOp(op) {
    return {
        opKey: op.opKey || null,
        type: op.type,

        id: op.id || null,
        path: op.path || null,

        oldPath: op.oldPath || null,
        newPath: op.newPath || null,
        realizeParentPath: op.realizeParentPath || null,
        realizeIndex: Number.isInteger(op.realizeIndex) ? op.realizeIndex : null,
        rebasedOldPath: op.rebasedOldPath || null,
        rebasedNewPath: op.rebasedNewPath || null,
        realizeReplacesPath: op.realizeReplacesPath || null,


        sidOld: op.sidOld || null,
        sidNew: op.sidNew || null,
        selfOldId: op.selfOldId || op.sidOld || op.sidNew || op.id || null,        mergeOwnerId: op.mergeOwnerId || null,
        mergeOwnerPath: op.mergeOwnerPath || null,

        payloadTag: op.payloadTag || null,
        payloadText: op.payloadText || "",
        payloadXml: op.payloadXml || "",
        realizeBeforeId: op.realizeBeforeId || null,
        realizeAfterId: op.realizeAfterId || null,

        subtreeIdsOld: Array.isArray(op.subtreeIdsOld) && op.subtreeIdsOld.length
            ? [...op.subtreeIdsOld]
            : [op.sidOld || op.selfOldId || op.id].filter(Boolean),

        subtreeIdsNew: Array.isArray(op.subtreeIdsNew) && op.subtreeIdsNew.length
            ? [...op.subtreeIdsNew]
            : [op.sidNew || op.sidOld || op.id].filter(Boolean),
        undoKey: op.undoKey || undoKey(op),

        contentOld: op.contentOld ? structuredClone(op.contentOld) : null,
        contentNew: op.contentNew ? structuredClone(op.contentNew) : null,
        contentDiff: op.contentDiff ? structuredClone(op.contentDiff) : null
    };
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

        body.innerHTML = payload.updates.map(op => `
            <div style="margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid #eee;">
                <strong>${describeOp(op)}</strong>
            </div>
        `).join("");
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

        const expanded = expandUndoOps(
            state.selectedOp,
            window.ALL_DIFF_OPS || state.selectedPayload?.updates || []
        );

        console.log("UNDO expanded ops", expanded.map(o => ({
            type: o.type,
            sidOld: o.sidOld,
            sidNew: o.sidNew,
            oldPath: o.oldPath,
            newPath: o.newPath,
            rebasedOldPath: o.rebasedOldPath,
            rebasedNewPath: o.rebasedNewPath
        })));

        const msg = {
            type: "UNDO_REQUEST",
            ops: expanded.map(toUndoPayloadOp)
        };

        console.log("UNDO sending request", msg);
        window.parent?.postMessage(msg, "*");
        window.dispatchEvent(new CustomEvent("undo-request", { detail: msg }));
    });
    cancelBtn?.addEventListener("click", hide);

    return { hide, showForPayload };
}