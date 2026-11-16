"use strict";

const app = require("./app");

const port = Number(process.env.PORT) || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(`vlsc-cicd-lab06 listening on port ${port}`);
});
