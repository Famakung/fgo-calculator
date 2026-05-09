/* Bond tab lazy entry point — loaded on demand via import() */
import { BondApp } from "./bond-app.js";
import {
  ServantSelector,
  AscensionSelector,
  ServantDrag,
  CESelector,
  CESubSelector,
} from "./selectors.js";

export function initBond() {
  BondApp.configure({
    ServantSelector,
    AscensionSelector,
    CESelector,
    CESubSelector,
    ServantDrag,
  });
  BondApp.init();
}