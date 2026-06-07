import {reverseOperations} from "./undo/reverseOperation.js";
import {findById} from "./xml.js";

function serializeXml(node) {
    return new XMLSerializer().serializeToString(node);
}

function stripGhostId(id) {
    return String(id || "")
        .replace(/^__ghost_delete__/, "")
        .replace(/^__ghost_move__/, "");
}

function stripGhostSubtree(el) {
    if (!el) return;

    for (const n of [el, ...Array.from(el.querySelectorAll("*"))]) {
        n.removeAttribute("_ghost");
        n.removeAttribute("_orig_id");

        const id = n.getAttribute("id");
        if (id) {
            const cleanId = stripGhostId(id);
            n.setAttribute("id", cleanId);
        }
    }
}

/**
 * Checks whether a subtree contains any id from a list
 * checks both raw ghost ids and cleaned ids
 * Used to find ghost subtrees that contain the operation’s affected id
 *
 * @param root
 * @param ids
 * @returns {boolean}
 */
function subtreeContainsAnyId(root, ids) {
    for (const el of Array.from(root.querySelectorAll("*"))) {
        const raw = el.getAttribute("id");
        const clean = stripGhostId(raw);
        if (ids.includes(raw) || ids.includes(clean)) return true;
    }
    return false;
}

/**
 * Sometimes a moved node’s old location is inside a deleted ghost region
 * searches delete ghost subtrees to find one that contains the moved node
 * Used as fallback for move undo
 *
 * @param root
 * @param op
 * @returns {unknown}
 */
function findContainingDeleteGhostForMove(root, op) {
    const ids = [
        op.sidOld,
        op.sidNew,
        op.selfOldId,
        op.mergeOwnerId,
        ...(op.subtreeIdsOld || []),
        ...(op.subtreeIdsNew || [])
    ].filter(Boolean);

    const candidates = Array.from(root.querySelectorAll("*")).filter(el => {
        const id = el.getAttribute("id") || "";
        return el.getAttribute("_ghost") === "delete" || id.startsWith("__ghost_delete__");
    });

    return candidates.find(g => {
        const gid = stripGhostId(g.getAttribute("id"));
        return ids.includes(gid) || subtreeContainsAnyId(g, ids);
    }) || null;
}

/**
 * Finds the ghost subtree representing a deleted old node
 *
 * @param root
 * @param op
 * @returns {unknown}
 */
function findDeleteGhost(root, op) {
    const ids = [
        op.sidOld,
        op.selfOldId,
        op.mergeOwnerId,
        ...(op.subtreeIdsOld || [])
    ].filter(Boolean);

    for (const id of ids) {
        const direct = findById(root, `__ghost_delete__${id}`);
        if (direct) return direct;
    }

    return Array.from(root.querySelectorAll(`*[_ghost="delete"]`)).find(g => {
        const gid = stripGhostId(g.getAttribute("id"));
        return ids.includes(gid);
    }) || null;
}

/**
 * Finds the ghost subtree representing old moved location
 *
 * @param root
 * @param op
 * @returns {unknown|null}
 */
function findMoveGhost(root, op) {
    const ids = [
        op.sidOld,
        op.sidNew,
        op.selfOldId,
        op.mergeOwnerId,
        ...(op.subtreeIdsOld || []),
        ...(op.subtreeIdsNew || [])
    ].filter(Boolean);

    for (const id of ids) {
        const direct = findById(root, `__ghost_move__${id}`);
        if (direct) return direct;
    }

    const ghosts = Array.from(root.querySelectorAll(`*[_ghost="move"]`));

    for (const g of ghosts) {
        const gid = stripGhostId(g.getAttribute("id"));
        if (ids.includes(gid)) return g;

        for (const id of ids) {
            if (g.querySelector?.(`*[id="${CSS.escape(id)}"]`)) {
                return g;
            }
        }
    }

    return null;
}

/**
 * Finds the current inserted/new node in the unified root
 * Used when undoing insert or move
 *
 * @param root
 * @param op
 * @returns {*|null}
 */
function findInsertedNode(root, op) {
    const ids = [
        op.sidNew,
        op.selfOldId,
        op.mergeOwnerId,
        ...(op.subtreeIdsNew || [])
    ].filter(Boolean);

    for (const id of ids) {
        const n = findById(root, id);
        if (n && n.getAttribute("_ghost") !== "delete") return n;
    }

    return null;
}

/**
 * does undo using the already rendered unified model
 * it takes the current unified XML containing: real new nodes, delete ghosts, move ghosts
 * Then applies undo visually/structurally
 *
 * @param currentNewXml
 * @param ops
 * @returns {string}
 */
function realizeVisualUndoFromUnified({ currentNewXml, ops }) {
    const unified = window.__UNIFIED_ROOT__?.cloneNode(true);
    if (!unified) {
        throw new Error("visual undo: missing window.__UNIFIED_ROOT__");
    }

    const insertOps = ops.filter(o => o.type === "insert");
    const deleteOps = ops.filter(o => o.type === "delete");
    const moveOps = ops.filter(o => o.type === "move" || o.type === "moveupdate");

    for (const op of insertOps) {
        const inserted = findInsertedNode(unified, op);
        inserted?.parentNode?.removeChild(inserted);
    }

    for (const op of deleteOps) {
        const ghost = findDeleteGhost(unified, op);
        if (ghost) stripGhostSubtree(ghost);
    }

    for (const op of moveOps) {
        const ghost =
            findMoveGhost(unified, op) ||
            findContainingDeleteGhostForMove(unified, op);
        if (!ghost) {
            continue;
        }

        const moved = findInsertedNode(unified, {
            ...op,
            sidNew: op.sidNew || op.sidOld,
            subtreeIdsNew: op.subtreeIdsNew?.length
                ? op.subtreeIdsNew
                : [op.sidNew || op.sidOld].filter(Boolean)
        });

        moved?.parentNode?.removeChild(moved);
        stripGhostSubtree(ghost);
    }
    // After applying selected undo, remove remaining ghosts
    for (const g of Array.from(unified.querySelectorAll(`*[_ghost]`))) {
        g.parentNode?.removeChild(g);
    }

    const currentDoc = new DOMParser().parseFromString(currentNewXml, "application/xml");
    const currentRoot = currentDoc.documentElement;
    const init = currentRoot.querySelector(`manipulate[id="init"]`);

    if (init && !unified.querySelector(`manipulate[id="init"]`)) {
        unified.insertBefore(init.cloneNode(true), unified.firstChild);
    }
    // final cleanup: no visual/helper ids in actual NEW XML
    for (const n of Array.from(unified.querySelectorAll("*"))) {
        n.removeAttribute("_orig_id");

        const id = n.getAttribute("id");
        if (id && id.startsWith("__gw_")) {
            n.removeAttribute("id");
        }
    }

    return serializeXml(unified);
}

/**
 * Call local recompute server
 * bridge back to computeDiffState()
 *
 * @param oldXml
 * @param newXml
 * @returns {Promise<*>}
 */
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

/**
 * installs an event listener for undo-request
 *
 * @param rerender
 */
export function installMockHostUndo({ rerender }) {
    const state = {
        baselineOldXml: window.OLD_TREE || window.OLD,
        currentNewXml: window.NEW_TREE || window.NEW,
    };

    window.addEventListener("undo-request", async (e) => {
        const msg = e.detail;
        const ops = msg?.ops; // Read ops when request arrives
        if (!ops?.length) return;

        console.log("mock host received undo request json", JSON.stringify(ops, null, 2));
        // Decide undo method, if structural op or only update
        try {
            const usesVisualUndo = ops.some(o =>
                o.type === "insert" ||
                o.type === "delete" ||
                o.type === "move" ||
                o.type === "moveupdate"
            );

            const nextNewXml = usesVisualUndo
                ? realizeVisualUndoFromUnified({
                    currentNewXml: state.currentNewXml,
                    ops
                })
                : reverseOperations({
                    baselineOldXml: state.baselineOldXml,
                    currentNewXml: state.currentNewXml,
                    ops
                });

            const diffResult = await recomputeDiffOnHost({
                oldXml: state.baselineOldXml,
                newXml: nextNewXml
            }); // recompute diff
            // update state
            state.baselineOldXml = diffResult.oldTreeXml || state.baselineOldXml;
            state.currentNewXml = diffResult.newTreeXml || nextNewXml;

            window.OLD_TREE = state.baselineOldXml;
            window.NEW_TREE = state.currentNewXml;
            window.OLD = state.baselineOldXml;
            window.NEW = state.currentNewXml;
            window.DIFF = diffResult.diffOps || [];
            window.DIFF_SOURCE = diffResult.diffSource || window.DIFF_SOURCE;

            window.UNDONE_OP_KEYS = new Set();

            window.postMessage({ type: "UNDO_APPLIED" }, "*");

            await rerender({
                oldXml: state.baselineOldXml,
                newXml: state.currentNewXml,
                diffOps: window.DIFF,
                diffSource: window.DIFF_SOURCE
            });
        } catch (err) {
            console.error("mock host undo failed", err);
            alert(`Undo failed: ${err.message}`);
        }
    });
}