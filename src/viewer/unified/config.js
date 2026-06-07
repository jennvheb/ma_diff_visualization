export const OP_PRIORITY = {
    delete: 1,
    insert: 2,
    update: 3,
    move: 4,
    moveupdate: 5,
};

export const OP_COLOR = {
    insert: "#22c55e",
    delete: "#ef4444",
    move: "#3b82f6",
    update: "#a855f7",
    moveupdate: "#ec4899",
};

export const toSegs = (p) => (p || "").split("/").filter(Boolean).map(Number);

export function parentPath(path) {
    const segs = toSegs(path);
    if (!segs.length) return "";
    return "/" + segs.slice(0, -1).join("/");
}

export function lastSeg(pathStr) {
    const segs = toSegs(pathStr);
    return segs.length ? segs[segs.length - 1] : null;
}

/**
 * creates operation key to stamp SVG group
 * used so clicks can later recover operation not only by id which may be ambiguous
 * @param op
 * @returns {string}
 */
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
