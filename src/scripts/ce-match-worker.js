import { computeCEMatchMatrix } from "./ce-matcher.js";

let _servants = null;
let _traitCEs = null;
let _traitNames = null;

self.onmessage = function (e) {
  const reqId = e.data?.reqId;
  try {
    const { type } = e.data || {};

    if (type === "init") {
      _servants = e.data.servants;
      _traitCEs = e.data.traitCEs;
      _traitNames = e.data.traitNames;
      return;
    }

    if (type === "compute") {
      if (!Array.isArray(_servants) || !Array.isArray(_traitCEs)) {
        self.postMessage({ type: "error", reqId, message: "Worker not initialized" });
        return;
      }
      const { results, index } = computeCEMatchMatrix(_servants, _traitCEs, _traitNames);
      self.postMessage({ type: "result", reqId, results, index });
    }
  } catch (err) {
    self.postMessage({ type: "error", reqId, message: String(err) });
  }
};
