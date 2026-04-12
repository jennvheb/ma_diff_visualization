import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {computeDiffState} from "./computeDiffState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

app.get("/health", (_req, res) => {
    res.json({ ok: true });
});

app.post(
    "/diff",
    upload.fields([
        { name: "old", maxCount: 1 },
        { name: "new", maxCount: 1 }
    ]),
    async (req, res) => {
        let tmpDir;

        try {
            const oldFile = req.files?.old?.[0];
            const newFile = req.files?.new?.[0];

            if (!oldFile || !newFile) {
                return res.status(400).json({
                    error: "Please upload both files as form-data fields: old and new"
                });
            }

            const algo = String(req.body.algo ?? "cpeediff").toLowerCase();
            const rawPassthrough =
                String(req.body.raw ?? "").toLowerCase() === "true";

            const requested = String(req.body.anchors ?? "all")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);

            const ALL = ["id", "endpoint", "label"];
            const anchors =
                requested.length === 1 && requested[0] === "all" ? ALL : requested;

            const mode = req.body.mode ?? "balanced";
            const pretty = String(req.body.pretty ?? "true") !== "false";

            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cpee-diff-"));

            const oldFilePath = path.join(tmpDir, "old.xml");
            const newFilePath = path.join(tmpDir, "new.xml");

            await fs.writeFile(oldFilePath, oldFile.buffer);
            await fs.writeFile(newFilePath, newFile.buffer);

            const result = await computeDiffState({
                algo,
                oldFilePath,
                newFilePath,
                rawPassthrough,
                anchors,
                mode,
                pretty,
                xydiffBinaryPath: path.resolve(__dirname, "../../xydiff-bin/xydiff")
            });

            res.json(result);
        } catch (err) {
            console.error("Diff failed:", err);
            res.status(500).json({
                error: err?.message ?? String(err)
            });
        } finally {
            if (tmpDir) {
                try {
                    await fs.rm(tmpDir, { recursive: true, force: true });
                } catch {}
            }
        }
    }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Diff server listening on http://localhost:${PORT}`);
});