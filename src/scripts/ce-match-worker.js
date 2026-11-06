import { computeCEMatchMatrix } from "./ce-matcher.js";

let _servants = null;
let _traitCEs = null;
let _traitNames = null;

self.onmessage = function (e) {
  const { type } = e.data;

  if (type === "init") {
    _servants = e.data.servants;
    _traitCEs = e.data.traitCEs;
    _traitNames = e.data.traitNames;
    return;
  }

  if (type === "compute") {
    const { results, index } = computeCEMatchMatrix(_servants, _traitCEs, _traitNames);
    self.postMessage({ type: "result", results, index });
  }
};
