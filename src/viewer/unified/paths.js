import {nearestDrawable} from "../../integration/stableIds.js";
import {toSegs} from "./config.js";
import {nodeAtPath} from "./xml.js";

/**
 * oldPath is in the dynamic tree at at operation opIndex
 * Rewind previous edits so it points into the original OLD tree
 *
 * @param oldPath
 * @param opIndex
 * @param ops
 * @returns {*|string}
 */
export function rebaseOldPathDynamicToStatic(oldPath, opIndex, ops) {
    if (!oldPath) return oldPath;
    let segs = toSegs(oldPath);
    if (!segs.length) return oldPath;

    function sameParent(pathSegs, opSegs, depth) {
        for (let d = 0; d < depth - 1; d++) {
            if (pathSegs[d] !== opSegs[d]) return false;
        }
        return true;
    }

    for (let i = opIndex - 1; i >= 0; i--) {
        const prev = ops[i];
        if (!prev) continue;

        // undo insert at prev.newPath
        if (prev.type === "insert" && prev.newPath) {
            const insSegs = toSegs(prev.newPath);
            const depth = insSegs.length;
            if (depth && depth <= segs.length && sameParent(segs, insSegs, depth)) {
                const jIns = insSegs[depth - 1];
                const j = segs[depth - 1];
                if (j > jIns) segs[depth - 1] = j - 1;
            }
        }

        // undo delete (and delete-part of moves) at prev.oldPath
        if ((prev.type === "delete" || prev.type === "move" || prev.type === "moveupdate") && prev.oldPath) {
            const delSegs = toSegs(prev.oldPath);
            const depth = delSegs.length;
            if (depth && depth <= segs.length && sameParent(segs, delSegs, depth)) {
                const jDel = delSegs[depth - 1];
                const j = segs[depth - 1];
                if (j >= jDel) segs[depth - 1] = j + 1;
            }
        }

        // undo insert-part of a move at prev.newPath
        if ((prev.type === "move" || prev.type === "moveupdate") && prev.newPath) {
            const insSegs = toSegs(prev.newPath);
            const depth = insSegs.length;
            if (depth && depth <= segs.length && sameParent(segs, insSegs, depth)) {
                const jIns = insSegs[depth - 1];
                const j = segs[depth - 1];
                if (j > jIns) segs[depth - 1] = j - 1;
            }
        }
    }

    return "/" + segs.join("/");
}

/**
 * newPath is in the dynamic tree after opIndex
 * Push it forward through later operations so it points into final NEW
 *
 * @param newPath
 * @param opIndex
 * @param ops
 * @returns {*|string}
 */
export function rebaseNewPathDynamicToFinal(newPath, opIndex, ops) {
    if (!newPath) return newPath;
    let segs = toSegs(newPath);
    if (!segs.length) return newPath;

    function sameParent(pathSegs, opSegs, depth) {
        for (let d = 0; d < depth - 1; d++) {
            if (pathSegs[d] !== opSegs[d]) return false;
        }
        return true;
    }

    for (let i = opIndex + 1; i < ops.length; i++) {
        const next = ops[i];
        if (!next) continue;

        // later delete at next.oldPath
        if ((next.type === "delete" || next.type === "move" || next.type === "moveupdate") && next.oldPath) {
            const delSegs = toSegs(next.oldPath);
            const depth = delSegs.length;
            if (depth && depth <= segs.length && sameParent(segs, delSegs, depth)) {
                const jDel = delSegs[depth - 1];
                const j = segs[depth - 1];
                if (j > jDel) segs[depth - 1] = j - 1;
            }
        }

        // later insert at next.newPath
        if ((next.type === "insert" || next.type === "move" || next.type === "moveupdate") && next.newPath) {
            const insSegs = toSegs(next.newPath);
            const depth = insSegs.length;
            if (depth && depth <= segs.length && sameParent(segs, insSegs, depth)) {
                const jIns = insSegs[depth - 1];
                const j = segs[depth - 1];
                if (j >= jIns) segs[depth - 1] = j + 1;
            }
        }
    }

    return "/" + segs.join("/");
}

/**
 * Chooses whether to trust the raw old path or the rebased old path
 * safety function because not every CpeeDiff path behaves the same
 *
 * @param op
 * @param idx
 * @param ops
 * @param oldRoot
 * @returns {*|string|null}
 */
export function preferStaticOldPath(op, idx, ops, oldRoot) {
    if (!op.oldPath) return null;

    const reb = rebaseOldPathDynamicToStatic(op.oldPath, idx, ops);

    // raw lookup
    const rawNode = nodeAtPath(oldRoot, op.oldPath);
    const rawOwner = rawNode ? nearestDrawable(rawNode) : null;

    // rebased lookup
    const rebNode = reb ? nodeAtPath(oldRoot, reb) : null;
    const rebOwner = rebNode ? nearestDrawable(rebNode) : null;

    // If raw points to a drawable, trust it (static semantics)
    if (rawOwner) return op.oldPath;

    // Otherwise try rebased (dynamic semantics)
    if (rebOwner) return reb;

    // last resort: keep raw
    return op.oldPath;
}

/**
 * Returns true if ancestorPath is above childPath
 * Used later to suppress nested ghost/move operations when an ancestor already covers them
 *
 * @param ancestorPath
 * @param childPath
 * @returns {boolean}
 */
export function isStrictAncestorPath(ancestorPath, childPath) {
    const a = toSegs(ancestorPath || "");
    const c = toSegs(childPath || "");
    if (!a.length || !c.length) return false;
    if (a.length >= c.length) return false;

    for (let i = 0; i < a.length; i++) {
        if (a[i] !== c[i]) return false;
    }
    return true;
}