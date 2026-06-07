import {idVariants, normalizeElementId} from "./ids.js";
import {opKey} from "./config.js";

/**
 * Builds opKey -> op
 * If colorize stamped data-op-key
 * click handler can retrieve exact operation
 *
 * @param metaOps
 * @returns {Map<any, any>}
 */
export function buildOpsByKey(metaOps) {
    const m = new Map();
    for (const op of metaOps || []) {
        m.set(opKey(op), op);
    }
    return m;
}

/**
 * fallback lookup
 * Builds id -> [ops]
 * using direct operation ids: sidOld, sidNew, selfOldId, mergeOwnerId, id
 *
 * @param metaOps
 * @returns {Map<any, any>}
 */
export function buildOpsByIdDirect(metaOps) {
    const m = new Map();
    function add(id, op) {
        for (const v of idVariants(id)) {
            if (!v) continue;
            if (!m.has(v)) m.set(v, []);
            m.get(v).push(op);
        }
    }
    for (const op of metaOps) {
        if (op.sidOld) add(op.sidOld, op);
        if (op.sidNew) add(op.sidNew, op);
        if (op.selfOldId) add(op.selfOldId, op);
        if (op.mergeOwnerId) add(op.mergeOwnerId, op);
        if (op.id) add(op.id, op);
    }
    return m;
}

/**
 * Builds id -> [ops]
 * using region/subtree ids: sidOld, sidNew, subtreeIdsOld, subtreeIdsNew
 * broader lookup
 * If user clicks a child inside a changed subtree, direct lookup might fail, but region lookup can still find the parent operation
 *
 * @param metaOps
 * @returns {Map<any, any>}
 */
export function buildOpsByIdRegion(metaOps) {
    const m = new Map();
    function add(id, op) {
        for (const v of idVariants(id)) {
            if (!v) continue;
            if (!m.has(v)) m.set(v, []);
            m.get(v).push(op);
        }
    }
    for (const op of metaOps) {
        const ids = new Set();
        if (op.sidOld) ids.add(op.sidOld);
        if (op.sidNew) ids.add(op.sidNew);
        for (const x of op.subtreeIdsOld || []) ids.add(x);
        for (const x of op.subtreeIdsNew || []) ids.add(x);
        for (const id of ids) add(id, op);
    }
    return m;
}

/**
 * Removes duplicate ops by opKey
 *
 * @param ops
 * @returns {*[]}
 */
function dedupeOps(ops) {
    const seen = new Set();
    const out = [];
    for (const op of ops || []) {
        const key = opKey(op);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(op);
    }
    return out;
}

/**
 * Given an SVG group, collects all nested g.element[element-id] ids
 * Used for region fallback
 *
 * @param gEl
 * @returns {*[]}
 */
function collectDescendantElementIdsFromSvg(gEl) {
    const out = [];
    if (!gEl) return out;
    const nodes = gEl.querySelectorAll?.('g.element[element-id]') || [];
    nodes.forEach((n) => {
        const id = n.getAttribute("element-id");
        if (id) out.push(id);
    });
    return out;
}

/**
 * Creates the payload sent to undo UI
 * This payload is what undoController receives
 *
 * @param clickedId
 * @param opsForId
 * @returns {{clickedId, updates: {sidNew, contentNew, subtreeIdsOld, realizeParentPath, rebasedNewPath, subtreeIdsNew, sidOld, oldPath, contentOld, type: *, opKey: string, realizeIndex: *|null, contentDiff, selfOldId, mergeOwnerId, rebasedOldPath, newPath}[]}}
 */
function buildClickPayload(clickedId, opsForId) {
    const interesting = opsForId || [];
    return {
        clickedId,
        updates: interesting.map((op) => ({
            opKey: opKey(op),
            type: op.type,
            rebasedOldPath: op.rebasedOldPath || null,
            rebasedNewPath: op.rebasedNewPath || null,
            sidOld: op.sidOld || null,
            sidNew: op.sidNew || null,
            oldPath: op.oldPath || null,
            newPath: op.newPath || null,
            realizeParentPath: op.realizeParentPath || null,
            realizeIndex: Number.isInteger(op.realizeIndex) ? op.realizeIndex : null,
            contentOld: op.contentOld || null,
            contentNew: op.contentNew || null,
            contentDiff: op.contentDiff || null,
            subtreeIdsOld: Array.isArray(op.subtreeIdsOld) && op.subtreeIdsOld.length
                ? [...op.subtreeIdsOld]
                : [op.sidOld || op.selfOldId || op.id].filter(Boolean),

            subtreeIdsNew: Array.isArray(op.subtreeIdsNew) && op.subtreeIdsNew.length
                ? [...op.subtreeIdsNew]
                : [op.sidNew || op.sidOld || op.id].filter(Boolean),
            selfOldId: op.selfOldId || op.sidOld || op.sidNew || op.id || null,
            mergeOwnerId: op.mergeOwnerId || null,
        })),
    };
}

/**
 * Removes visual prefixes
 * Used so ghost clicks can map back to the real operation id
 *
 * @param id
 * @returns {*|string}
 */
function unwrapGhostId(id) {
    if (!id || typeof id !== "string") return id;
    return id
        .replace(/^ele-/, "")
        .replace(/^__ghost_delete__/, "")
        .replace(/^__ghost_move__/, "");
}

/**
 * installs click handlers on:
 * #layout-new
 * #graph-new
 *
 * @param opsByIdDirect
 * @param opsByIdRegion
 * @param opsByKey
 */
export function installUnifiedClickHandler({ opsByIdDirect, opsByIdRegion, opsByKey }) {
    const layout = document.getElementById("layout-new");
    if (!layout) return;

    const handler = (e) => {
        const hit = e.target.closest?.("[element-id], [data-op-key]"); // find clicked visual element
        if (!hit) {
            window.dispatchEvent(new CustomEvent("diff-element-empty-click"));
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();

        // exact op-key lookup
        const stampedKey =
            hit.getAttribute("data-op-key") ||
            hit.closest?.("[data-op-key]")?.getAttribute("data-op-key") ||
            null;

        let opsForId = [];
        let clickedId = null;

        if (stampedKey && opsByKey?.has(stampedKey)) {
            const op = opsByKey.get(stampedKey);
            opsForId = op ? [op] : [];
            clickedId = op?.sidNew || op?.sidOld || null;
        } else {
            // fallback: old id-based behavior
            const rawClicked = hit.getAttribute("element-id");
            if (!rawClicked) {
                window.dispatchEvent(new CustomEvent("diff-element-empty-click"));
                return;
            }

            clickedId = normalizeElementId(rawClicked);
            const baseClickedId = unwrapGhostId(clickedId);
            // try several variants against ops index
            opsForId = []
                .concat(opsByIdDirect.get(rawClicked) || [])
                .concat(opsByIdDirect.get(clickedId) || [])
                .concat(opsByIdDirect.get(baseClickedId) || [])
                .concat(opsByIdDirect.get("ele-" + clickedId) || [])
                .concat(opsByIdDirect.get("ele-" + baseClickedId) || []);

            // if direct lookup fails, try region lookup from the surrounding SVG group
            if (!opsForId.length) {
                const group =
                    hit.closest?.("g.group") ||
                    hit.closest?.("g.element") ||
                    hit.closest?.("svg") ||
                    null;

                if (group) {
                    const descIds = collectDescendantElementIdsFromSvg(group);

                    // include clicked id
                    const allIds = [rawClicked, clickedId, baseClickedId, ...descIds];

                    for (const did of allIds) {
                        for (const v of idVariants(did)) {
                            const arr = opsByIdRegion.get(v) || [];
                            if (arr.length) opsForId.push(...arr);
                        }
                    }
                }
            }
        }
        // ghost filtering: if user clicked delete ghost, prefer exact delete ops for that node
        opsForId = dedupeOps(opsForId);
        if (clickedId.startsWith("__ghost_delete__")) {
            const wanted = unwrapGhostId(clickedId);
            const exactDelete = opsForId.filter(op =>
                op.type === "delete" && (op.sidOld === wanted || op.selfOldId === wanted)
            );
            if (exactDelete.length) opsForId = exactDelete;
        }
        // if user clicked move ghost, prefer exact move/moveupdate ops for that node
        if (clickedId.startsWith("__ghost_move__")) {
            const wanted = unwrapGhostId(clickedId);
            const exactMove = opsForId.filter(op =>
                (op.type === "move" || op.type === "moveupdate") &&
                (op.sidOld === wanted || op.sidNew === wanted || op.selfOldId === wanted)
            );
            if (exactMove.length) opsForId = exactMove;
        }
        if (!opsForId.length) {
            window.dispatchEvent(new CustomEvent("diff-element-empty-click"));
            return;
        }
        const payload = buildClickPayload(clickedId, opsForId);
        // send payload
        window.parent?.postMessage({
            type: "DIFF_ELEMENT_CLICK",
            payload
        }, "*");
        // send payload
        window.dispatchEvent(new CustomEvent("diff-element-click", { detail: payload }));
    };

    if (layout) {
        if (layout.__unifiedClickHandler) {
            layout.removeEventListener("click", layout.__unifiedClickHandler, true);
        }
        layout.__unifiedClickHandler = handler;
        layout.__unifiedClickInstalled = true;
        layout.addEventListener("click", handler, true);
    }
}