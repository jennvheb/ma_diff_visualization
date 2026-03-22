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

    for (const tNode of tNodes) {
        for (const edit of Array.from(tNode.childNodes || []).filter(n => n.nodeType === 1)) {
            if (edit.localName === "au") {
                const attr = edit.getAttribute("a") || "";
                const ov = edit.getAttribute("ov") || "";
                const nv = edit.getAttribute("nv") || "";
                const xid = edit.getAttribute("xid") || "";

                if (attr === "id" && nv) {
                    const nvS = String(nv);
                    state.renamedNewIds.add(nvS);
                    if (ov) state.renamedIdPairs.set(nvS, String(ov));
                }

                if (attr === "endpoint") markEdit(xid, "endpoint");
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
}
