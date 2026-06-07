const {DOMParser, XMLSerializer} = await import("@xmldom/xmldom");
import {stampLogicalIds} from "../stableIds.js";
import fs from "fs";
import path from "node:path";
import os from "node:os";
import {execFileSync} from "node:child_process";


export function findDslRoot(doc) {
    const NS = "http://cpee.org/ns/description/1.0";
    if (!doc?.documentElement) return null;

    let last = null;
    const stack = [doc.documentElement];
    while (stack.length) {
        const n = stack.pop();
        if (n?.nodeType !== 1) continue;

        if (n.localName === "description" && n.namespaceURI === NS) last = n;

        const kids = n.childNodes || [];
        for (let i = kids.length - 1; i >= 0; i--) {
            const c = kids[i];
            if (c?.nodeType === 1) stack.push(c);
        }
    }
    return last;
}

/**
 * prepares XML before sending it to XYDiff
 *
 * @param xmlString
 * @returns {*}
 */
export function projectForXyDiff(xmlString) {
    const doc = new DOMParser().parseFromString(xmlString, "text/xml"); // turns xml string into DOM tree
    const root = findDslRoot(doc) || doc.documentElement; // find CPEE root or document root as fallback

    // useful for real task ids and viewer consistency
    stampLogicalIds(root); // adds stable synthetic ids to gateways/drawable elements that do not have real ids

    return new XMLSerializer().serializeToString(doc); // converts the modified DOM back into XML text which is what xydiff actually compares
}

export function loadDom(filePath) {
    const xml = fs.readFileSync(filePath, "utf8");
    return new DOMParser().parseFromString(xml, "text/xml");
}

/**
 * execution wrapper around the external XYDiff binary
 * the actual binary runner
 *
 * @param binaryPath
 * @param oldTreeXmlString
 * @param newTreeXmlString
 * @returns {{output: string, oldFile: *, newFile: *, cleanupWorkDir: boolean, workDir: string}}
 */
export function runXyDiffBinary({ binaryPath, oldTreeXmlString, newTreeXmlString }) {
    const binaryDir = path.dirname(binaryPath);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "xydiff-"));

    const oldFile     = path.join(workDir, "old.xml");
    const newFile     = path.join(workDir, "new.xml");


    // project + stabilize BEFORE diff, stamps gateway/stable ids into both models for stabilization
    let oldProj = projectForXyDiff(oldTreeXmlString);
    let newProj = projectForXyDiff(newTreeXmlString);


    // write projected inputs
    fs.writeFileSync(oldFile, oldProj, "utf8");
    fs.writeFileSync(newFile, newProj, "utf8");

    // run xydiff, output is the raw XYDiff XML/string result
    const output = execFileSync(binaryPath, [oldFile, newFile], {
        cwd: workDir,
        env: { ...process.env, DYLD_LIBRARY_PATH: binaryDir },
        encoding: "utf8",
    });

    return { output, workDir, oldFile, newFile, cleanupWorkDir: true};
}
