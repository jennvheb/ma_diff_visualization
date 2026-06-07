import {collectNodesPostorder} from "../dom/domUtils.js";
import fs from "fs";

/**
 * Parses expressions like:
 * (1-17;206-377;18-205;378|379)
 * into:
 * {
 *   seq: [1,2,3,...],
 *   next: 379
 * }
 * The seq is the XID assignment sequence
 *
 * @param s
 * @returns {{next: number, seq: *[]}|null}
 */
function parseXidMapExpr(s) {
    // "(1-17;206-377;18-205;378|379)"
    const m = String(s || "").trim().match(/^\(?\s*([^|]+)\|\s*(\d+)\s*\)?$/);
    if (!m) return null;

    const rangesPart = m[1].trim();
    const next = Number(m[2]);

    const seq = [];
    for (const chunk of rangesPart.split(";").map(x => x.trim()).filter(Boolean)) {
        const rm = chunk.match(/^(\d+)\s*-\s*(\d+)$/);
        if (rm) {
            const a = Number(rm[1]), b = Number(rm[2]);
            for (let v = a; v <= b; v++) seq.push(v);
            continue;
        }
        const sm = chunk.match(/^(\d+)$/);
        if (sm) {
            seq.push(Number(sm[1]));
            continue;
        }
        throw new Error(`Unrecognized xidmap chunk: "${chunk}"`);
    }

    return { seq, next };
}

/**
 * reads the first non-empty line from .xidmap file and parses it.
 *
 * @param filePath
 * @returns {{next: number, seq: *[]}|null}
 */
export function loadXidMapExpr(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const head = fs.readFileSync(filePath, "utf8").split(/\r?\n/).find(Boolean) || "";
    return parseXidMapExpr(head.trim());
}

/**
 * collects document nodes in postorder
 * then pairs seq[i] -> nodes[i]
 * so the xid can be mapped to a node
 *
 * @param doc
 * @param xidmapExpr
 * @returns {Map<any, any>|null}
 */
export function buildXidIndexFromXidMap(doc, xidmapExpr) {
    if (!doc?.documentElement || !xidmapExpr?.seq) return null;

    const nodes = collectNodesPostorder(doc);
    const seq = xidmapExpr.seq;

    const map = new Map(); // xid -> node
    const n = Math.min(seq.length, nodes.length);
    for (let i = 0; i < n; i++) {
        map.set(String(seq[i]), nodes[i]);
    }
    return map;
}

/**
 * builds a simpler preorder index
 * resolves parent element in new/old from xidmap, then converts dom-position to element index
 *
 * used as fallback for cases where text insert positioning is easier to resolve from traversal order
 *
 * @param doc
 * @returns {Map<any, any>}
 */
export function buildXyDiffXidIndex(doc) {
    const map = new Map();
    let counter = 0;

    const add = (node) => map.set(String(++counter), node);
    const isWhitespaceText = (n) =>
        n && n.nodeType === 3 && String(n.nodeValue || "").trim() === "";

    function visit(node) {
        if (!node) return;

        if (node.nodeType === 1) {
            add(node);

            for (let i = 0; i < node.childNodes.length; i++) {
                const c = node.childNodes[i];
                if (c.nodeType === 1) visit(c);
                else if (c.nodeType === 3) { if (!isWhitespaceText(c)) add(c); }
                // ignore comments
            }
            return;
        }

        if (node.nodeType === 3 && !isWhitespaceText(node)) add(node);
    }

    if (doc?.documentElement) visit(doc.documentElement);
    return map;
}
