import fs from "node:fs";
import path from "node:path";

import {Preprocessor} from "../../cpeediff/src/io/Preprocessor.js";
import {CpeeDiff} from "../../cpeediff/src/diff/CpeeDiff.js";
import {DiffConfig} from "../../cpeediff/src/config/DiffConfig.js";

import {parseXyDiffToDelta} from "../integration/xyDiff/parseXyDiffToDelta.js";
import {runXyDiffBinary} from "../integration/xyDiff/runXyDiffBinary.js";
import {deltaXmlToOps} from "../integration/xyDiff/deltaXmlToOps.js";
import {editScriptToOps} from "../integration/cpeeDiff/editScriptToOps.js";

function configureDiff({ anchors = ["id", "endpoint", "label"], mode = "balanced", pretty = true }) {
    DiffConfig.MATCH_ANCHORS = anchors;
    DiffConfig.MATCH_MODE = mode;
    DiffConfig.PRETTY_XML = pretty;
}

export async function computeDiffState({
                                           algo,
                                           oldXmlString = null,
                                           newXmlString = null,
                                           oldFilePath = null,
                                           newFilePath = null,
                                           rawPassthrough = false,
                                           anchors = ["id", "endpoint", "label"],
                                           mode = "balanced",
                                           pretty = true,
                                           xydiffBinaryPath = null
                                       }) {
    const normalizedAlgo = String(algo || "").toLowerCase();
    configureDiff({ anchors, mode, pretty });

    if (normalizedAlgo === "cpeediff") {
        let oldTree, newTree;

        if (oldFilePath && newFilePath) {
            const pre = new Preprocessor();
            oldTree = pre.fromFile(oldFilePath);
            newTree = pre.fromFile(newFilePath);
        } else if (oldXmlString && newXmlString) {
            const pre = new Preprocessor();
            oldTree = pre.fromString(oldXmlString);
            newTree = pre.fromString(newXmlString);
        } else {
            throw new Error("computeDiffState(cpeediff): need either file paths or XML strings");
        }

        const differ = new CpeeDiff();
        const editScript = differ.diff(oldTree, newTree);

        return {
            oldTreeXml: oldTree.toXmlString(),
            newTreeXml: newTree.toXmlString(),
            diffSource: "cpeediff",
            diffOps: editScriptToOps(editScript),
            rawDiffXml: editScript.toXmlString()
        };
    }

    if (normalizedAlgo === "xydiff") {
        let oldTreeXmlString, newTreeXmlString;

        if (oldXmlString && newXmlString) {
            oldTreeXmlString = oldXmlString;
            newTreeXmlString = newXmlString;
        } else if (oldFilePath && newFilePath) {
            if (rawPassthrough) {
                oldTreeXmlString = fs.readFileSync(oldFilePath, "utf8");
                newTreeXmlString = fs.readFileSync(newFilePath, "utf8");
            } else {
                const pre = new Preprocessor();
                const oldTree = pre.fromFile(oldFilePath);
                const newTree = pre.fromFile(newFilePath);
                oldTreeXmlString = oldTree.toXmlString();
                newTreeXmlString = newTree.toXmlString();
            }
        } else {
            throw new Error("computeDiffState(xydiff): need either file paths or XML strings");
        }

        if (!xydiffBinaryPath) {
            throw new Error("computeDiffState(xydiff): missing xydiffBinaryPath");
        }

        const { output, workDir, oldFile, newFile } = runXyDiffBinary({
            binaryPath: xydiffBinaryPath,
            oldTreeXmlString,
            newTreeXmlString,
        });

        try {
            if (rawPassthrough) {
                return {
                    oldTreeXml: oldTreeXmlString,
                    newTreeXml: newTreeXmlString,
                    diffSource: "xydiff",
                    diffOps: [],
                    rawDiffXml: output
                };
            }

            const deltaXml = parseXyDiffToDelta(output, workDir);
            const opsJson = deltaXmlToOps(deltaXml);

            return {
                oldTreeXml: oldTreeXmlString,
                newTreeXml: newTreeXmlString,
                diffSource: "xydiff",
                diffOps: opsJson,
                rawDiffXml: deltaXml
            };
        } finally {
            try {
                for (const f of [
                    oldFile,
                    newFile,
                    path.join(workDir, "old.xml.xidmap"),
                    path.join(workDir, "new.xml.xidmap"),
                ]) {
                    if (f && fs.existsSync(f)) fs.unlinkSync(f);
                }
            } catch {
                // ignore cleanup failures
            }
        }
    }

    throw new Error(`unknown algo: ${normalizedAlgo}`);
}