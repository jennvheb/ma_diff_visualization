/**
 * remove duplicate operations from the diff to keep the visualization clean from noise
 * xydiff emits many operations for one edit
 *
 * @param ops
 * @returns {*[]}
 */
export function dedupeOps(ops) {
    const seen = new Set();
    const out = [];

    for (const op of ops) {
        const key = [
            op.kind,
            op.oldPath || "",
            op.newPath || "",
            op.attr || "",
            op.oldValue || "",
            op.newValue || ""
        ].join("|");

        if (seen.has(key)) continue;
        seen.add(key);
        out.push(op);
    }

    return out;
}
