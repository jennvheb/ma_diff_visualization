const { DOMParser } = await import("@xmldom/xmldom");

export function deltaXmlToOps(deltaXmlString) {
    const doc = new DOMParser().parseFromString(deltaXmlString, "text/xml");
    const delta = doc.documentElement;
    if (!delta || (delta.localName || delta.tagName) !== "delta") return [];

    const ops = [];
    const seen = new Set(); // dedupe exact duplicates

    for (let i = 0; i < delta.childNodes.length; i++) {
        const n = delta.childNodes[i];
        if (!n || n.nodeType !== 1) continue;

        const tag = (n.localName || n.tagName || "").toLowerCase();

        if (tag === "insert") {
            const newPath = n.getAttribute("newPath");
            if (!newPath) continue;
            console.error("[XY INSERT NODE ATTRS]", Array.from(n.attributes).map(a => `${a.name}=${a.value}`));


            const op = {
                type: "insert",
                id: null,
                path: newPath,
                oldPath: null,
                newPath,
                from: "new",
                meta: {}
            };

            const key = `${op.type}|${op.oldPath || ""}|${op.newPath || ""}`;
            if (!seen.has(key)) { seen.add(key); ops.push(op); }
        }

        else if (tag === "delete") {
            const oldPath = n.getAttribute("oldPath");
            if (!oldPath) continue;

            const op = {
                type: "delete",
                id: null,
                path: oldPath,
                oldPath,
                newPath: null,
                from: "old",
                meta: {}
            };

            const key = `${op.type}|${op.oldPath || ""}|${op.newPath || ""}`;
            if (!seen.has(key)) { seen.add(key); ops.push(op); }
        }

        else if (tag === "move") {
            const oldPath = n.getAttribute("oldPath");
            const newPath = n.getAttribute("newPath");
            if (!oldPath || !newPath) continue;

            // detect nested update payload (runner emits <move> ... <update> ... </move>)
            // FIXME
            let hasUpdateChild = false;
            for (let j = 0; j < n.childNodes.length; j++) {
                const c = n.childNodes[j];
                if (c && c.nodeType === 1 && (c.localName || c.tagName || "").toLowerCase() === "update") {
                    hasUpdateChild = true;
                    break;
                }
            }

            const op = {
                type: hasUpdateChild ? "moveupdate" : "move",
                id: null,
                path: oldPath,
                oldPath,
                newPath,
                from: "both",
                meta: hasUpdateChild ? { hasUpdate: true } : {}
            };

            const key = `${op.type}|${op.oldPath || ""}|${op.newPath || ""}`;
            if (!seen.has(key)) { seen.add(key); ops.push(op); }
        }
        else if (tag === "moveupdate") {
            const oldPath = n.getAttribute("oldPath");
            const newPath = n.getAttribute("newPath");
            if (!oldPath || !newPath) continue;

            const op = {
                type: "moveupdate",
                id: null,
                path: oldPath,
                oldPath,
                newPath,
                from: "both",
                meta: { hasUpdate: true }
            };

            const key = `${op.type}|${op.oldPath || ""}|${op.newPath || ""}`;
            if (!seen.has(key)) { seen.add(key); ops.push(op); }
        }

        else if (tag === "update") {
            const oldPath = n.getAttribute("oldPath");
            if (!oldPath) continue;

            // collect first child element
            let payloadEl = null;
            for (let j = 0; j < n.childNodes.length; j++) {
                const c = n.childNodes[j];
                if (c && c.nodeType === 1) { payloadEl = c; break; }
            }
            if (!payloadEl) continue;

            const payloadTag = (payloadEl.localName || payloadEl.tagName || "").toLowerCase();

            // skip id rename artifact
            if (payloadTag === "id") continue;

            const meta = { kind: payloadTag };

            // attribute update form: <cancel oldValue="" newValue=""/>
            if (payloadEl.getAttribute && payloadEl.hasAttribute("oldValue") && payloadEl.hasAttribute("newValue")) {
                meta.attr = payloadTag;
                meta.oldValue = payloadEl.getAttribute("oldValue");
                meta.newValue = payloadEl.getAttribute("newValue");
            }

            // text update form: <_text newValue="..."/>
            if (payloadTag === "_text") {
                meta.newValue = payloadEl.getAttribute("newValue") ?? "";
            }

            const op = {
                type: "update",
                id: null,
                path: oldPath,
                oldPath,
                newPath: null,
                from: "old",
                meta
            };

            const key = `${op.type}|${op.oldPath || ""}|${op.newPath || ""}|${meta.kind || ""}|${meta.attr || ""}|${meta.newValue || ""}`;
            if (!seen.has(key)) { seen.add(key); ops.push(op); }
        }

    }

    return ops;
}
