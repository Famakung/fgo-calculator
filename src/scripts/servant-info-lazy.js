/* Servant Info tab lazy entry point — loaded on demand via import() */
import { ServantInfoApp } from "./servant-info-app.js";

export function initServantInfo() {
  ServantInfoApp.init();
}
