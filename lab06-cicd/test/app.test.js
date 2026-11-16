"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const app = require("../src/app");

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test("GET /healthz returns 200 and status ok", async () => {
  const res = await fetch(`${baseUrl}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
});

test("GET /api/status returns 200 and service identity", async () => {
  const res = await fetch(`${baseUrl}/api/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.service, "vlsc-cicd-lab06");
  assert.ok(typeof body.commit === "string");
});
