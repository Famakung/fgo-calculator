/* Event Shop lazy entry point — loaded on demand via import() */
import { App } from "./event-shop.js";

export function initEvent() {
  App.init();
}
