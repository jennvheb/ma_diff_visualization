import {escapeXmlAttr} from "../ops/opUtils.js";

function indentXml(xml, prefix = "  ") {
    return String(xml || "")
        .split(/\r?\n/)
        .map(line => line.trim() ? prefix + line : line)
        .join("\n");
}

/**
 * converts cleaned xydiff operations into <delta> xml format
 * writes on xml element per operation
 *
 * @param operationsClean
 * @returns {string}
 */
export function emitDeltaXml(operationsClean) {
    console.error("DELTA OPS:", operationsClean.map(o => ({
        kind: o.kind,
        oldPath: o.oldPath,
        newPath: o.newPath
    })));

    let deltaXml = `<delta cost="${operationsClean.length}">\n`;

    for (const op of operationsClean) {
        // skips inserts without payloads
        if (op.kind === "insert") {
            if (!op.payload) {
                continue;
            }
            deltaXml += `  <insert newPath="${escapeXmlAttr(op.newPath)}">\n`;
            deltaXml += indentXml(op.payload, "    ") + "\n";
            deltaXml += `  </insert>\n`;
        } else if (op.kind === "delete") {
            const rawOld = op.oldPath;
            deltaXml += `  <delete oldPath="${rawOld}"/>\n`;
        } else if (op.kind === "update-attr") {
            const opath = op.oldPath;
            deltaXml += `  <update oldPath="${opath}">\n    <${op.attr} oldValue="${escapeXmlAttr(op.oldValue)}" newValue="${escapeXmlAttr(op.newValue)}"/>\n  </update>\n`;
        } else if (op.kind === "update-node") {
            const opath = op.oldPath;
            deltaXml += `  <update oldPath="${opath}">\n    ${op.newPayload}\n  </update>\n`;
        } else if (op.kind === "update-text") {
            const opath = op.oldPath;
            deltaXml += `  <update oldPath="${opath}">\n    <_text newValue="${escapeXmlAttr(op.newValue || "")}"/>\n  </update>\n`;
        } else if (op.kind === "move") {
            const rawOld = op.oldPath;
            const npath = op.newPath;
            deltaXml += `  <move oldPath="${rawOld}" newPath="${npath}"/>\n`;
        } else if (op.kind === "moveupdate") {
            const rawOld = op.oldPath;
            const npath = op.newPath;
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
