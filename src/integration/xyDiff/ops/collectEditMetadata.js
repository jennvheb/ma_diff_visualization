/*
interprets the xydiff and fills the state object with edits
collect all edits that happen to a node and are relevant to the visualization
this helps to inform if an endpoint or label or id change occured and tracks renames for ghost logic
FIXME: relevance? endpoint or label? maybe more here from other functions too?
 */
export function collectEditMetadata(tNodes, state) {
    function markEdit(xid, what) {
        if (!xid) return;
        const k = String(xid);
        if (!state.editsByXid.has(k)) state.editsByXid.set(k, new Set());
        state.editsByXid.get(k).add(what);
    }

    const byXid = new Map();

    function entry(xid) {
        const k = String(xid || "");
        if (!k) return null;
        if (!byXid.has(k)) byXid.set(k, {});
        return byXid.get(k);
    }

    for (const tNode of tNodes) {
        for (const edit of Array.from(tNode.childNodes || []).filter(n => n.nodeType === 1)) {
            if (edit.localName === "au") {
                const attr = edit.getAttribute("a") || "";
                const ov = edit.getAttribute("ov") || "";
                const nv = edit.getAttribute("nv") || "";
                const xid = edit.getAttribute("xid") || "";

                const e = entry(xid);

                if (attr === "id" && e) {
                    e.oldId = ov || null;
                    e.newId = nv || null;

                    if (nv) {
                        state.renamedNewIds.add(String(nv));
                        if (ov) state.renamedIdPairs.set(String(nv), String(ov));
                    }

                    markEdit(xid, "id");
                }

                if (attr === "endpoint" && e) {
                    e.oldEndpoint = ov ?? "";
                    e.newEndpoint = nv ?? "";
                    markEdit(xid, "endpoint");
                }

                if (attr === "label") markEdit(xid, "label");
                if (attr === "mode" || attr === "cancel") markEdit(xid, attr);

                continue;
            }

            if (edit.localName === "ad") {
                const xid = edit.getAttribute("xid") || "";
                const a = edit.getAttribute("a") || "";
                if (a === "label") markEdit(xid, "label");
            }
        }
    }

    // XYDiff matched two different calls as one node.
    // id + endpoint changed on same xid => visualize as delete old + insert new
    for (const [xid, e] of byXid.entries()) {
        if (e.oldId && e.newId && e.oldEndpoint !== undefined) {
            if (!state.replacementByXid) state.replacementByXid = new Map();

            state.replacementByXid.set(xid, {
                oldId: e.oldId,
                newId: e.newId,
                oldEndpoint: e.oldEndpoint,
                newEndpoint: e.newEndpoint
            });

            console.error("xy replacement, delete old insert new", {
                xid,
                oldId: e.oldId,
                newId: e.newId,
                oldEndpoint: e.oldEndpoint,
                newEndpoint: e.newEndpoint
            });
        }
    }
}