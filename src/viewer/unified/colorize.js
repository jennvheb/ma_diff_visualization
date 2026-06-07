import {ghostifyId, idVariants, isGhostId} from "./ids.js";
import {OP_COLOR, OP_PRIORITY, opKey} from "./config.js";

/**
 * Adds operation metadata to the SVG group
 * important for the click handler
 * The strongest click path is:
 * clicked SVG has data-op-key
 * -> retrieve exact op
 * rather than guessing by id
 *
 * @param gEl
 * @param op
 */
function stampOpMetadata(gEl, op) {
    if (!gEl || !op) return;

    gEl.setAttribute("data-op-key", opKey(op));
    gEl.setAttribute("data-op-type", op.type || "");

    if (op.sidOld) gEl.setAttribute("data-sid-old", op.sidOld);
    if (op.sidNew) gEl.setAttribute("data-sid-new", op.sidNew);

    if (op.rebasedOldPath) gEl.setAttribute("data-old-path", op.rebasedOldPath);
    if (op.rebasedNewPath) gEl.setAttribute("data-new-path", op.rebasedNewPath);
}

/**
 * Builds a lookup map:
 * id -> [SVG elements]
 * lets colorization find SVG elements even if ids appear as:
 * a1
 * ele-a1
 * __ghost_delete__a1
 *
 * @param rootEl
 * @returns {Map<any, any>}
 */
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

/**
 * Checks whether an SVG element is inside a ghost subtree
 * used for visual rules
 *
 * @param el
 * @param ghostPrefix
 * @returns {boolean}
 */
function ancestorHasGhost(el, ghostPrefix) {
    if (!el) return false;
    // look up to nearest SVG group container
    const host = el.closest("g.element") || el;
    // check any ancestor g.element with element-id prefix
    const anc = host.closest?.(`g.element[element-id^="${ghostPrefix}"]`);
    // closest() includes self; exclude self for "inside" check
    return !!(anc && anc !== host);
}

/**
 * Detects whether an SVG group represents a gateway/branch
 *
 * @param gEl
 * @returns {boolean}
 */
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

/**
 * ensures old ghosts have the correct outline
 *
 * @param logicalId
 * @param baseColor
 * @returns {*|string|null}
 */
function ghostStrokeFor(logicalId, baseColor) {
    if (typeof logicalId !== "string") return null;
    if (!logicalId.startsWith("__ghost_")) return null;

    if (logicalId.startsWith("__ghost_delete__")) return OP_COLOR.delete; // red outline
    if (logicalId.startsWith("__ghost_move__")) return OP_COLOR.move; // blue outline
    return baseColor; // fallback
}

/**
 * Checks if an SVG group itself is an old ghost
 *
 * @param gEl
 * @returns {boolean}
 */
function isOldGhostSvgGroup(gEl) {
    const eid = gEl?.getAttribute?.("element-id") || "";
    return (
        eid.startsWith("__ghost_delete__") ||
        eid.startsWith("__ghost_move__") ||
        eid.startsWith("ele-__ghost_delete__") ||
        eid.startsWith("ele-__ghost_move__")
    );
}

/**
 * changes SVG styles
 * picks the visual shape then applies fill, stroke, opacity, fill-opacity
 * with special cases for old ghost, gateway, outline-only cases
 *
 * @param gEl
 * @param fillColor
 * @param opType
 * @param strokeOverride
 * @param ctx
 */
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

/**
 * finds SVG groups already rendered by the viewer and colors them based on the diff operation
 *
 * @param idx
 * @param metaOps
 */
export function colorizeUnified(idx, metaOps) {
    // sort ops by priority
    const opsSorted = [...metaOps].sort(
        (a, b) => (OP_PRIORITY[a.type] ?? 0) - (OP_PRIORITY[b.type] ?? 0)
    );

    // for each operation, decide which ids to color
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
            // updates can color the real node
            const sid = op.sidNew || op.sidOld;
            if (sid) idsToColor.add(sid);
        }

        if (op.type === "move" || op.type === "moveupdate") {
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
