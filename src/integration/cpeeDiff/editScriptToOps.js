import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
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

function nodeText(n) {
    return (n?.textContent || "").replace(/\s+/g, " ").trim();
}

function nodeXml(n) {
    if (!n) return "";
    try {
        return new XMLSerializer().serializeToString(n);
    } catch {
        return "";
    }
}

function firstExisting(...xs) {
    return xs.find(Boolean) || null;
}

function updatePayloadsByPath(rawDiffXml) {
    const map = new Map();
    if (!rawDiffXml) return map;

    const doc = new DOMParser().parseFromString(rawDiffXml, "application/xml");

    for (const u of Array.from(doc.getElementsByTagName("update"))) {
        const oldPath = u.getAttribute("oldPath");
        if (!oldPath) continue;

        const payloadXml = Array.from(u.childNodes || [])
            .map(n => new XMLSerializer().serializeToString(n))
            .join("")
            .trim();

        const payloadText = (u.textContent || "").replace(/\s+/g, " ").trim();
        const firstEl = Array.from(u.childNodes || []).find(n => n.nodeType === 1);

        map.set(oldPath, {
            payloadTag: firstEl?.localName || firstEl?.tagName || null,
            payloadId: firstEl?.getAttribute?.("id") || null,
            payloadText,
            payloadXml
        });
    }

    return map;
}
function nodeAttr(n, name) {
    return n?.attributes?.get?.(name) ?? n?.getAttribute?.(name) ?? null;
}
export function editScriptToOps(editScript, rawDiffXml = "") {
    const ops = editScript.editOperations || [];
    const updatePayloads = updatePayloadsByPath(rawDiffXml);

    const mapped = ops.map(op => {
        const oldPath = toPathString(op.oldPath);
        const xmlPayload = oldPath ? updatePayloads.get(oldPath) : null;
        const newPath = toPathString(op.newPath);

        const path = oldPath || newPath;
        const from = oldPath ? "old" : "new";

        const payloadNode = firstExisting(
            op.newContent,
            op.content,
            op.node,
            op.update,
            op.payload,
        );

        console.log("cpeediff op content payload", {
            type: op.type,
            keys: Object.keys(op),
            oldPath,
            newPath,
            payloadTag: xmlPayload?.payloadTag || payloadNode?.localName || payloadNode?.tagName || null,
            payloadText: xmlPayload?.payloadText || nodeText(payloadNode),
            payloadXml: xmlPayload?.payloadXml || nodeXml(payloadNode),
            op
        });
        const id =
            xmlPayload?.payloadId ||
            nodeAttr(op.newContent, "id") ||
            null;

        return {
            type: op.type,
            id,
            path,
            oldPath,
            newPath,
            from,

            payloadTag: xmlPayload?.payloadTag || payloadNode?.localName || payloadNode?.tagName || null,
            payloadText: xmlPayload?.payloadText || nodeText(payloadNode),
            payloadXml: xmlPayload?.payloadXml || nodeXml(payloadNode),
        };
    });

    console.error("mapped (before filter) count", mapped.length);
    console.error("dropped count", mapped.filter(o => !(o.type && o.path)).length);

    return mapped.filter(o => o.type && o.path);
}
// convert the edit script to json ops for the visualization for easier access
