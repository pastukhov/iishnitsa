"use strict";

const { Buffer } = require("node:buffer");
const fs = require("node:fs");
const path = require("node:path");
const parser = require("image-size-parser");

// Metro 0.84 consumes the callable v1 API, including synchronous filenames.
// Keep the previous 512 KiB read limit; use the official fixed v2 parser.
function imageSize(input) {
  if (input instanceof Uint8Array) return parser.imageSize(input);
  if (typeof input !== "string")
    throw new TypeError("Expected a buffer or filename");
  const descriptor = fs.openSync(path.resolve(input), "r");
  try {
    const size = fs.fstatSync(descriptor).size;
    if (size <= 0) throw new Error("Empty file");
    const buffer = Buffer.alloc(Math.min(size, 512 * 1024));
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return parser.imageSize(buffer.subarray(0, bytesRead));
  } finally {
    fs.closeSync(descriptor);
  }
}

module.exports = imageSize;
module.exports.default = imageSize;
module.exports.imageSize = imageSize;
module.exports.disableTypes = parser.disableTypes;
module.exports.types = parser.types;
