// normalize and standardize the paths for further processing
function toPathString(p) {
    if (p == null) return null;

    // special cases where path is an array
    if (Array.isArray(p)) {
        if (!p.length) return null;
        return '/' + p.join('/');
    }

    // most cases path is a string
    const s = String(p).trim();
    if (!s) return null;

    if (s.startsWith('/')) return s;

    return '/' + s;
}


// convert the edit script to json ops for the visualization for easier access
export function editScriptToOps(editScript) {
    const ops = editScript.editOperations || [];

    const mapped = ops.map(op => {

        const oldPath = toPathString(op.oldPath);
        const newPath = toPathString(op.newPath);

        const path = oldPath || newPath;
        const from = oldPath ? 'old' : 'new';

        let id = op.newContent?.attributes.get("id") ?? null;

        return {
            type: op.type,
            id,
            path,
            oldPath,
            newPath,
            from,
        };
    });//.filter(o => o.type && o.path);
    console.error("mapped (before filter) count", mapped.length);
    console.error("dropped count", mapped.filter(o => !(o.type && o.path)).length);
    return mapped.filter(o => o.type && o.path);
}
