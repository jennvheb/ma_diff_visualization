import {escapeXmlAttr} from "../ops/opUtils.js";

function normalizeRoot(pathStr) {
    return pathStr;
}

function indentXml(xml, prefix = "  ") {
    return String(xml || "")
        .split(/\r?\n/)
        .map(line => line.trim() ? prefix + line : line)
        .join("\n");
}

export function emitDeltaXml(operationsClean, baseOld, elementByRelIndexPath) {
    console.error("DELTA OPS:", operationsClean.map(o => ({
        kind: o.kind,
        oldPath: o.oldPath,
        newPath: o.newPath
    })));

    let deltaXml = `<delta cost="${operationsClean.length}">\n`;

    for (const op of operationsClean) {
        if (op.kind === "insert") {
            if (!op.payload) {
                console.error("skip insert because no payload", op);
                continue;
            }

            deltaXml += `  <insert newPath="${escapeXmlAttr(op.newPath)}">\n`;
            deltaXml += indentXml(op.payload, "    ") + "\n";
            deltaXml += `  </insert>\n`;
        } else if (op.kind === "delete") {
            const rawOld = normalizeRoot(op.oldPath);
            deltaXml += `  <delete oldPath="${rawOld}"/>\n`;
        } else if (op.kind === "update-attr") {
            const opath = normalizeRoot(op.oldPath);
            deltaXml += `  <update oldPath="${opath}">\n    <${op.attr} oldValue="${escapeXmlAttr(op.oldValue)}" newValue="${escapeXmlAttr(op.newValue)}"/>\n  </update>\n`;
        } else if (op.kind === "update-node") {
            const opath = normalizeRoot(op.oldPath);
            deltaXml += `  <update oldPath="${opath}">\n    ${op.newPayload}\n  </update>\n`;
        } else if (op.kind === "update-text") {
            const opath = normalizeRoot(op.oldPath);
            deltaXml += `  <update oldPath="${opath}">\n    <_text newValue="${escapeXmlAttr(op.newValue || "")}"/>\n  </update>\n`;
        } else if (op.kind === "move") {
            const rawOld = normalizeRoot(op.oldPath);
            const npath = normalizeRoot(op.newPath);
            const testEl = elementByRelIndexPath(baseOld, rawOld);

            console.error("DEBUG EMIT MOVE:", {
                rawOld,
                rawOldId: testEl?.getAttribute?.("id") || null,
                rawOldTag: testEl?.localName || null
            });

            deltaXml += `  <move oldPath="${rawOld}" newPath="${npath}"/>\n`;
        } else if (op.kind === "moveupdate") {
            const rawOld = normalizeRoot(op.oldPath);
            const npath = normalizeRoot(op.newPath);
            deltaXml += `  <moveupdate oldPath="${rawOld}" newPath="${npath}">\n`;
            if (op.newPayload) {
                deltaXml += `    <update>\n      ${op.newPayload}\n    </update>\n`;
            }
            deltaXml += `  </moveupdate>\n`;
        }
    }

    deltaXml += `</delta>`;
    return deltaXml;
}
