/**
 * used in undo popover
 *
 * @param op
 * @returns {string}
 */
function describeOp(op) {
    const id = op.sidNew || op.sidOld || "(no id)";
    if (op.type === "insert") return `Insert ${id}`;
    if (op.type === "delete") return `Delete ${id}`;
    if (op.type === "move") return `Move ${id}`;
    if (op.type === "update") return `Update ${id}`;
    if (op.type === "moveupdate") return `Move + update ${id}`;
    return `${op.type} ${id}`;
}

/**
 * creates a stable string identifying an operation
 * used to track/distinguish operations
 *
 * @param op
 * @returns {string}
 */
function undoKey(op) {
    const oldP = op.rebasedOldPath || op.oldPath || "";
    const newP = op.rebasedNewPath || op.newPath || "";
    const id = op.sidOld || op.sidNew || op.selfOldId || op.id || "";

    return `${op.type}|${id}|${oldP}|${newP}`;
}

/**
 * When several operations are associated with the clicked visual element, this scores which one is most likely intended
 * used in subtrees
 *
 * @param op
 * @param clickedId
 * @returns {number}
 */
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


/**
 * Checks whether two operations refer to the same logical node by comparing ids
 * Used to detect related insert/delete pairs.
 *
 * @param a
 * @param b
 * @returns {boolean}
 */
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

/**
 * Checks whether two id arrays share at least one id
 * Used for subtree overlap
 * Needed because it gives an indication two operations are related, even among moved/deleted edits in the area
 *
 * @param a
 * @param b
 * @returns {boolean}
 */
function intersects(a = [], b = []) {
    const set = new Set((a || []).filter(Boolean));
    return (b || []).some(x => x && set.has(x));
}

/**
 * If selected op is an insert, try to find matching delete
 * If selected op is a delete, try to find matching insert
 * -> handles replacement-like changes: delete old node + insert new node
 * If they refer to same logical/subtree ids, undo should undo both together
 *
 * @param op
 * @param allOps
 * @returns {*|null}
 */
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

/**
 * Expands one selected visual op into one or more actual undo operations
 * needed for move+update, delete+insert
 *
 * @param op
 * @param allOps
 * @returns {(*)[]|[(*&{type: string}),(*&{type: string})]|*[]}
 */
function expandUndoOps(op, allOps = []) {
    if (!op) return [];

    if (op.type === "moveupdate") {
        // A real moveupdate should normally refer to the same logical node.
        // If old/new ids differ, do NOT split it into update + move
        if (
            op.sidOld &&
            op.sidNew &&
            op.sidOld !== op.sidNew &&
            !String(op.sidOld).startsWith("__gw_") &&
            !String(op.sidNew).startsWith("__gw_")
        ) {
            return [op];
        }

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

/**
 * sends only the fields needed for undo to the host
 * also fills fallback subtree id arrays if missing
 *
 * @param op
 * @returns {{sidNew: (*|null), subtreeIdsOld: (*[]|*[]), realizeParentPath: (*|null), subtreeIdsNew: (*[]|*[]), sidOld: (*|null), type, realizeBeforeId: null, path: null, realizeIndex: (*|null), mergeOwnerPath: (string|*|null), contentDiff: (*|null), mergeOwnerId: (*|null), id: null, newPath: null, realizeReplacesPath: null, payloadTag: (string|*|null), contentNew: (*|null), rebasedNewPath: (*|null), payloadText: (string|*), payloadXml: (string|*), realizeAfterId: null, oldPath: null, contentOld: (*|null), opKey: (*|null), selfOldId: (*|null), undoKey: (string|*|string), rebasedOldPath: (*|null)}}
 */
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
        selfOldId: op.selfOldId || op.sidOld || op.sidNew || op.id || null,
        mergeOwnerId: op.mergeOwnerId || null,
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

/**
 * wires the UI to events
 *
 * @returns {{hide: hide, showForPayload: showForPayload}}
 */
export function installUndoController() {
    // Gets DOM elements
    const pop = document.getElementById("undo-popover");
    const body = document.getElementById("undo-popover-body");
    const undoBtn = document.getElementById("undo-btn");
    const cancelBtn = document.getElementById("undo-cancel-btn");
    // Internal state
    const state = {
        selectedPayload: null,
        selectedOp: null,
    };

    // Closes the popover and clears selection
    function hide() {
        if (pop) pop.hidden = true;
        state.selectedPayload = null;
        state.selectedOp = null;
        if (body) body.innerHTML = "";
    }

    /**
     * Receives clicked diff payload, hide if no updates
     * otherwise store payload, choose the best op based on clicked id, render ops into popover and show popover
     *
     * @param payload
     */
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

        const msg = {
            type: "UNDO_REQUEST",
            ops: expanded.map(toUndoPayloadOp)
        };

        // supports both external host and local mockHost
        window.parent?.postMessage(msg, "*");
        window.dispatchEvent(new CustomEvent("undo-request", { detail: msg }));
    });
    cancelBtn?.addEventListener("click", hide);

    return { hide, showForPayload };
}