import path from "node:path";
const {XMLSerializer} = await import("@xmldom/xmldom");
import {buildDrawableIndexById} from "../dom/signatures.js";
import {loadXidMapExpr, buildXidIndexFromXidMap} from "../xid/xidMap.js";
import {findDslRoot, loadDom} from "../runXyDiffBinary.js";

/**
 * build the lookup data needed while parsing xydiff output: map node to xid and dom node, from cpee ids to drawable elements, locate node in old vs. new
 * acts as reference context for parser
 *
 * @param workDir
 * @returns {{oldDom: *, baseNew: (*|HTMLElement|ActiveX.IXMLDOMElement), oldXidIndex: (Map<unknown, unknown>|Map<any, any>), oldDrawablesById, newDom: *, serializer, baseOld: (*|HTMLElement|ActiveX.IXMLDOMElement), workDir, newDrawablesById, newXidIndex: (Map<unknown, unknown>|Map<any, any>)}}
 */
export function buildParseContext(workDir) {
    const oldDom = loadDom(path.join(workDir, "old.xml"));
    const newDom = loadDom(path.join(workDir, "new.xml"));

    const baseOld = findDslRoot(oldDom) || oldDom.documentElement;
    const baseNew = findDslRoot(newDom) || newDom.documentElement;

    const oldXidMapExpr = loadXidMapExpr(path.join(workDir, "old.xml.xidmap"));
    const newXidMapExpr = loadXidMapExpr(path.join(workDir, "new.xml.xidmap"));

    const oldXidIndex = buildXidIndexFromXidMap(oldDom, oldXidMapExpr);
    const newXidIndex = buildXidIndexFromXidMap(newDom, newXidMapExpr);

    return {
        workDir,
        oldDom,
        newDom,
        baseOld,
        baseNew,
        oldXidIndex,
        newXidIndex,
        oldDrawablesById: buildDrawableIndexById(baseOld),
        newDrawablesById: buildDrawableIndexById(baseNew),
        serializer: new XMLSerializer()
    };
}
