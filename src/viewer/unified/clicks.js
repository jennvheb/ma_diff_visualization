import {isGatewayTagName, tagName} from "../../integration/stableIds.js";
import {idVariants, normalizeElementId} from "./ids.js";

export function opKey(op) {
    return [
        op.type || "",
        op.sidOld || "",
        op.sidNew || "",
        op.rebasedOldPath || "",
        op.rebasedNewPath || "",
        op.oldPath || "",
        op.newPath || ""
    ].join("|");
}

export function buildOpsByKey(metaOps) {
    const m = new Map();
    for (const op of metaOps || []) {
        m.set(opKey(op), op);
    }
    return m;
}

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
    }
    return m;
}

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
            contentOld: op.contentOld || null,
            contentNew: op.contentNew || null,
            subtreeIdsOld: op.subtreeIdsOld || [],
            subtreeIdsNew: op.subtreeIdsNew || [],
            selfOldId: op.selfOldId || null,
            mergeOwnerId: op.mergeOwnerId || null,
        })),
    };
}
function unwrapGhostId(id) {
    if (!id || typeof id !== "string") return id;
    return id
        .replace(/^ele-/, "")
        .replace(/^__ghost_delete__/, "")
        .replace(/^__ghost_move__/, "");
}
export function installUnifiedClickHandler({ unifiedRoot, opsByIdDirect, opsByIdRegion, opsByKey }) {
    const layout = document.getElementById("layout-new");
    const svg = document.getElementById("graph-new");
    if (!layout && !svg) return;

    const handler = (e) => {
        const hit = e.target.closest?.("[element-id], [data-op-key]");
        if (!hit) {
            window.dispatchEvent(new CustomEvent("diff-element-empty-click"));
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();

        // strongest path: exact op stamped onto the visual element
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

            opsForId = []
                .concat(opsByIdDirect.get(rawClicked) || [])
                .concat(opsByIdDirect.get(clickedId) || [])
                .concat(opsByIdDirect.get(baseClickedId) || [])
                .concat(opsByIdDirect.get("ele-" + clickedId) || [])
                .concat(opsByIdDirect.get("ele-" + baseClickedId) || []);

            const xmlNode = unifiedRoot.querySelector?.(`*[id="${CSS.escape(clickedId)}"]`);
            const clickedIsGateway = xmlNode && isGatewayTagName(tagName(xmlNode));
            const clickedIsGhost = clickedId.startsWith("__ghost");

            if (!opsForId.length && (clickedIsGateway || clickedIsGhost)) {
                const group = hit.closest?.("g.group") || hit.closest?.("g.element") || hit.closest?.("svg") || null;
                if (group) {
                    const descIds = collectDescendantElementIdsFromSvg(group);
                    for (const did of descIds) {
                        for (const v of idVariants(did)) {
                            const arr = opsByIdRegion.get(v) || [];
                            if (arr.length) opsForId.push(...arr);
                        }
                    }
                }
            }
        }

        opsForId = dedupeOps(opsForId);
        if (clickedId.startsWith("__ghost_delete__")) {
            const wanted = unwrapGhostId(clickedId);
            const exactDelete = opsForId.filter(op =>
                op.type === "delete" && (op.sidOld === wanted || op.selfOldId === wanted)
            );
            if (exactDelete.length) opsForId = exactDelete;
        }

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
        console.log("clicks: clickedId", clickedId, "resolved ops", opsForId);
        console.log("clicks: first resolved op JSON", JSON.stringify(opsForId?.[0] || null, null, 2));
        const payload = buildClickPayload(clickedId, opsForId);

        console.log("click payload", payload);

        window.parent?.postMessage({
            type: "DIFF_ELEMENT_CLICK",
            payload
        }, "*");

        window.dispatchEvent(new CustomEvent("diff-element-click", { detail: payload }));
    };

    if (layout && !layout.__unifiedClickInstalled) {
        layout.__unifiedClickInstalled = true;
        layout.addEventListener("click", handler, true);
    }
    if (svg && !svg.__unifiedClickInstalled) {
        svg.__unifiedClickInstalled = true;
        svg.addEventListener("click", handler, true);
    }
}