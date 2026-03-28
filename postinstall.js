"use strict";

const fs = require("node:fs");
const path = require("node:path");

const compiledEntry = path.join(__dirname, "dist", "postinstall.js");

if (fs.existsSync(compiledEntry)) {
  const postinstall = require(compiledEntry);

  if (postinstall && typeof postinstall.runPostinstall === "function") {
    postinstall.runPostinstall();
  }
}
