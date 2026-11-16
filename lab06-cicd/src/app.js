"use strict";

const express = require("express");

const app = express();
const startedAt = Date.now();

app.disable("x-powered-by");

app.get("/healthz", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
  });
});

app.get("/api/status", (req, res) => {
  res.status(200).json({
    service: "vlsc-cicd-lab06",
    commit: process.env.GIT_SHA || "unknown",
    node: process.version,
  });
});

module.exports = app;
