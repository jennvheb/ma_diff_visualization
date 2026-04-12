import {ghostifyId, idVariants, isGhostId} from "./ids.js";
import {OP_COLOR, OP_PRIORITY} from "./config.js";

function opKey(op) {
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

function stampOpMetadata(gEl, op) {
    if (!gEl || !op) return;

    gEl.setAttribute("data-op-key", opKey(op));
    gEl.setAttribute("data-op-type", op.type || "");

    if (op.sidOld) gEl.setAttribute("data-sid-old", op.sidOld);
    if (op.sidNew) gEl.setAttribute("data-sid-new", op.sidNew);

    if (op.rebasedOldPath) gEl.setAttribute("data-old-path", op.rebasedOldPath);
    if (op.rebasedNewPath) gEl.setAttribute("data-new-path", op.rebasedNewPath);
}
export function buildIdIndex(rootEl) {
    const idx = new Map();
    if (!rootEl) return idx;

    const all = rootEl.querySelectorAll("g.element[element-id]");
    all.forEach((g) => {
        const raw = g.getAttribute("element-id");
        if (!raw) return;

        // index raw + normalized + ele- prefixed variants
        for (const v of idVariants(raw)) {
            if (!v) continue;
            if (!idx.has(v)) idx.set(v, []);
            idx.get(v).push(g);
        }
    });

    return idx;
}

function ancestorHasGhost(el, ghostPrefix) {
    if (!el) return false;
    // look up to nearest SVG group container
    const host = el.closest("g.element") || el;
    // check any ancestor g.element with element-id prefix
    const anc = host.closest?.(`g.element[element-id^="${ghostPrefix}"]`);
    // closest() includes self; exclude self for "inside" check if you want:
    return !!(anc && anc !== host);
}

function isGatewayElementGroup(gEl) {
    const id = gEl?.getAttribute?.("element-id") || "";
    if (id.startsWith("__gw_") || id.startsWith("ele-__gw_")) return true;
    const t = (gEl?.getAttribute?.("element-type") || "").toLowerCase();
    return (
        t.includes("loop") ||
        t.includes("parallel") ||
        t.includes("choose") ||
        t.includes("otherwise") ||
        t.includes("alternative") ||
        t.includes("branch")
    );
}

function ghostStrokeFor(logicalId, baseColor) {
    if (typeof logicalId !== "string") return null;
    if (!logicalId.startsWith("__ghost_")) return null;

    if (logicalId.startsWith("__ghost_delete__")) return OP_COLOR.delete; // red outline
    if (logicalId.startsWith("__ghost_move__")) return OP_COLOR.move; // blue outline
    return baseColor; // fallback
}

function isOldGhostSvgGroup(gEl) {
    const eid = gEl?.getAttribute?.("element-id") || "";
    return (
        eid.startsWith("__ghost_delete__") ||
        eid.startsWith("__ghost_move__") ||
        eid.startsWith("ele-__ghost_delete__") ||
        eid.startsWith("ele-__ghost_move__")
    );
}

function colorNodeBody(gEl, fillColor, opType, strokeOverride = null, ctx = {}) {
    if (!gEl) return;

    const strokeColor = strokeOverride || fillColor;
    const shape = gEl.querySelector("rect.colorstyle, polygon, path, rect.white, rect") || gEl;
    const isGw = isGatewayElementGroup(gEl);

    const { inDeleteCtx, inMoveCtx, isMoveGhost, isDeleteGhost } = ctx;
    const isOldGhost =
        isOldGhostSvgGroup(gEl) ||
        isMoveGhost || isDeleteGhost || // the logicalId currently colored
        inMoveCtx || inDeleteCtx; // anything *inside* an old ghost subtree

    gEl.style.setProperty("opacity", isOldGhost ? "0.65" : "1", "important");

    // move ghost inside delete region => outline only
    const outlineOnly =
        (opType === "move" && inDeleteCtx) ||
        (opType === "delete" && inMoveCtx);

    if (outlineOnly) {
        shape.style.setProperty("stroke", strokeColor, "important");

        const strokeEls = gEl.querySelectorAll("line, path, polygon, rect, circle, ellipse");
        strokeEls.forEach((el) => el.style.setProperty("stroke", strokeColor, "important"));

        gEl.setAttribute("data-op", opType);
        gEl.classList.add(`op-${opType}`);
        return;
    }

    if (isGw) {
        shape.style.setProperty("fill", fillColor, "important");
        shape.style.setProperty("fill-opacity", isOldGhost ? "0.25" : "1", "important");
        shape.style.setProperty("stroke", strokeColor, "important");
    }
    else {
        shape.style.setProperty("fill", fillColor, "important");
        shape.style.setProperty("fill-opacity", "1", "important");
        shape.style.setProperty("stroke", strokeColor, "important");

        const strokeEls = gEl.querySelectorAll("line, path, polygon, rect, circle, ellipse");
        strokeEls.forEach((el) => el.style.setProperty("stroke", strokeColor, "important"));
    }

    gEl.setAttribute("data-op", opType);
    gEl.classList.add(`op-${opType}`);
}

export function colorizeUnified(idx, metaOps) {
    const opsSorted = [...metaOps].sort(
        (a, b) => (OP_PRIORITY[a.type] ?? 0) - (OP_PRIORITY[b.type] ?? 0)
    );

    for (const op of opsSorted) {
        const color = OP_COLOR[op.type];
        if (!color) continue;


        const idsToColor = new Set();

        if (op.type === "insert") {
            if (op.sidNew) idsToColor.add(op.sidNew);
            for (const sid of op.subtreeIdsNew || []) idsToColor.add(sid);
        }

        // OLD subtree as ghosts for delete/move/moveupdate
        if (op.type === "delete") {
            for (const sid of op.subtreeIdsOld || []) idsToColor.add(ghostifyId("delete", sid));
            if (op.sidOld) idsToColor.add(ghostifyId("delete", op.sidOld));
        }

        if (op.type === "update") {
            console.log("colorize update: op", {
                sidOld: op.sidOld,
                sidNew: op.sidNew,
                oldPath: op.oldPath,
                rebasedOldPath: op.rebasedOldPath,
                contentDiff: op.contentDiff
            });
        }
        const lookupId = op.sidNew || op.sidOld;
        console.log("colorize update: lookupId", lookupId);

        const hits =
            (idx.get(lookupId) || []).length +
            (idx.get("ele-" + lookupId) || []).length;

        console.log("colorize update: hits", hits);
        if (op.type === "update") {
            // updates can color the real node
            const sid = op.sidNew || op.sidOld;
            if (sid) idsToColor.add(sid);
        }
        if (op.type === "move") console.log("COLOR move", op.sidOld, op.sidNew);


        if (op.type === "move" || op.type === "moveupdate") {
            if (op.type === "moveupdate") console.log("COLOR moveupdate", op.sidOld, op.sidNew);
            if (op.sidNew) idsToColor.add(op.sidNew);
            for (const sid of op.subtreeIdsNew || []) idsToColor.add(sid);
            // move ghost exists
            for (const sid of op.subtreeIdsOld || []) idsToColor.add(ghostifyId("move", sid));
            if (op.sidOld) idsToColor.add(ghostifyId("move", op.sidOld));

            // IMPORTANT: if the moved node lies inside a deleted region,
            // it will be rendered as __ghost_delete__<id>, not __ghost_move__<id>.
            for (const sid of op.subtreeIdsOld || []) idsToColor.add(ghostifyId("delete", sid));
            if (op.sidOld) idsToColor.add(ghostifyId("delete", op.sidOld));
        }


        for (const logicalId of idsToColor) {
            const els = idx.get(logicalId) || [];
            if (op.type === "move" && String(logicalId).startsWith("__ghost_move__")) {
                console.log("MOVE lookup", logicalId, "hits", (idx.get(logicalId) || []).length);
            }

            for (const el of els) {
                const g = el.closest("g.element") || el.closest("g") || el;

                // don’t override something already colored
                const existing = g.getAttribute("data-op");
                if (existing) {
                    const pOld = OP_PRIORITY[existing] ?? 0;
                    const pNew = OP_PRIORITY[op.type] ?? 0;

                    // only override if new op is higher priority
                    if (pNew <= pOld) continue;
                }


                const logicalIdStr = String(logicalId);
                const inDeleteCtx = ancestorHasGhost(g, "__ghost_delete__");
                const inMoveCtx   = ancestorHasGhost(g, "__ghost_move__");

                const isMoveGhost   = isGhostId(logicalIdStr, "move");
                const isDeleteGhost  = isGhostId(logicalIdStr, "delete");
                const strokeOverride = ghostStrokeFor(logicalId, color);


                stampOpMetadata(g, op);
                colorNodeBody(g, color, op.type, strokeOverride, {
                    inDeleteCtx,
                    inMoveCtx,
                    isMoveGhost,
                    isDeleteGhost
                });

            }
        }
    }
}
