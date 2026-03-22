import {isGatewayTagName, tagName} from "../../integration/stableIds.js";
import {idVariants, normalizeElementId} from "./ids.js";

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
        const key = [
            op.type,
            op.sidOld || "",
            op.sidNew || "",
            op.rebasedOldPath || "",
            op.rebasedNewPath || "",
        ].join("|");
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
            type: op.type,
            rebasedOldPath: op.rebasedOldPath || null,
            rebasedNewPath: op.rebasedNewPath || null,
            sidOld: op.sidOld || null,
            sidNew: op.sidNew || null,
            oldPath: op.oldPath || null,
            newPath: op.newPath || null,
            contentOld: op.contentOld || null,
            contentNew: op.contentNew || null,
        })),
    };
}

export function installUnifiedClickHandler({ unifiedRoot, opsByIdDirect, opsByIdRegion }) {
    const layout = document.getElementById("layout-new");
    const svg = document.getElementById("graph-new");
    if (!layout && !svg) return;

    const handler = (e) => {
        const hit = e.target.closest?.("[element-id]");
        if (!hit) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();

        const rawClicked = hit.getAttribute("element-id");
        if (!rawClicked) return;

        const clickedId = normalizeElementId(rawClicked);

        // direct ops for this id
        let opsForId = []
            .concat(opsByIdDirect.get(rawClicked) || [])
            .concat(opsByIdDirect.get(clickedId) || [])
            .concat(opsByIdDirect.get("ele-" + clickedId) || []);

        const xmlNode = unifiedRoot.querySelector?.(`*[id="${CSS.escape(clickedId)}"]`);
        const clickedIsGateway = xmlNode && isGatewayTagName(tagName(xmlNode));

        // region fallback only if no direct ops AND gateway/group click
        if (!opsForId.length && clickedIsGateway) {
            const group = hit.closest?.("g.group") || hit.closest?.("svg") || null;
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

        opsForId = dedupeOps(opsForId);
        if (!opsForId.length) return;


        const payload = buildClickPayload(clickedId, opsForId);

        console.log("click payload", payload);
        window.parent?.postMessage(payload, "*");
    };

    // install once
    if (layout && !layout.__unifiedClickInstalled) {
        layout.__unifiedClickInstalled = true;
        layout.addEventListener("click", handler, true); // capture
    }
    if (svg && !svg.__unifiedClickInstalled) {
        svg.__unifiedClickInstalled = true;
        svg.addEventListener("click", handler, true); // capture
    }
}