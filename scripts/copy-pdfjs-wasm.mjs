import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceDirectory = path.join(
  projectRoot,
  "node_modules",
  "pdfjs-dist",
  "wasm",
);
const tesseractSourceDirectory = path.join(
  projectRoot,
  "node_modules",
  "tesseract.js",
  "dist",
);
const tesseractCoreDirectory = path.join(
  projectRoot,
  "node_modules",
  "tesseract.js-core",
);
const targetDirectory = path.join(projectRoot, "public", "pdfjs", "wasm");
const tesseractTargetDirectory = path.join(projectRoot, "public", "tesseract");

await mkdir(targetDirectory, { recursive: true });
await mkdir(tesseractTargetDirectory, { recursive: true });

for (const file of [
  "jbig2.wasm",
  "openjpeg.wasm",
  "qcms_bg.wasm",
  "LICENSE_JBIG2",
  "LICENSE_OPENJPEG",
  "LICENSE_PDFJS_JBIG2",
  "LICENSE_PDFJS_OPENJPEG",
  "LICENSE_PDFJS_QCMS",
  "LICENSE_QCMS",
]) {
  await copyFile(
    path.join(sourceDirectory, file),
    path.join(targetDirectory, file),
  );
}

for (const [source, target] of [
  [
    path.join(tesseractSourceDirectory, "worker.min.js"),
    path.join(tesseractTargetDirectory, "worker.min.js"),
  ],
  [
    path.join(tesseractSourceDirectory, "worker.min.js.LICENSE.txt"),
    path.join(tesseractTargetDirectory, "LICENSE_TESSERACT_WORKER"),
  ],
  [
    path.join(tesseractCoreDirectory, "tesseract-core-lstm.wasm.js"),
    path.join(tesseractTargetDirectory, "tesseract-core-lstm.wasm.js"),
  ],
  [
    path.join(tesseractCoreDirectory, "tesseract-core-lstm.wasm"),
    path.join(tesseractTargetDirectory, "tesseract-core-lstm.wasm"),
  ],
  [
    path.join(tesseractCoreDirectory, "LICENSE"),
    path.join(tesseractTargetDirectory, "LICENSE_TESSERACT_CORE"),
  ],
]) {
  await copyFile(source, target);
}
