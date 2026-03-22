// remove duplicate ops from the diff
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
