import { DOMFactory } from "./presentation.js";

/* ===...=== Single-line continuous-loop names (Amendment R25, extended by R26, R27) ===...=== */
/* Three surfaces print a name too wide for its box: the results "Quests to Play" cards, the
   Drop Rates per Run quest names (#farmGrid) and the Shop Requirements tier-card item names
   (.material-name). A name occupies exactly ONE line. A name wider than its box is measured after
   render with the single span at rest (scrollWidth − clientWidth), then its text is rebuilt into a
   sliding track: the name twice — name + gap + name, the duplicate aria-hidden so screen readers
   still read it once — inside a span the CSS moves continuously left, translateX 0 → −50% of the
   track; the track is two name+gap units wide, so each cycle shifts exactly one name+gap and the
   loop is seamless, never an oscillation. --slide-duration scales with the name width so every
   name travels at the same speed. Names that fit stay one static span with no track and no
   animation. The full text always lives in the title attribute, and prefers-reduced-motion
   disables the animation, so nothing is only reachable by sliding.
   The tier cards ship their name as static markup, so applySlidingName restructures the surviving
   div into the container+inner-span shape once and every later update first clears any track back
   to the single span — the markup stays the single place the class names are declared.
   Re-measure is ONE debounced pass installed on first refresh and never removed, scheduled by two
   triggers: a window resize listener, and — Amendment R29 — a ResizeObserver on the permanent
   #panel-event, because Event Shop hydrates at idle while that panel is display:none and a hidden
   name measures scrollWidth == clientWidth == 0, reading as a perfect fit. A tab reveal is a box
   change (no box → a box), so the observer re-measures exactly when the names gain layout; the
   panel is static markup no re-render replaces, so one observer watches one node for the app's
   lifetime and no observation accumulates. The cards below are rebuilt per Calculate with
   replaceChildren, so every pass queries the live DOM instead of holding node references — rebuilt
   or absent names cost nothing. createElement/textContent/setAttribute only (TT-safe). */

const NAME_CLASS = "farm-quest-name";
const MATERIAL_NAME_CLASS = "material-name";
const NAME_TEXT_CLASS = "farm-quest-name-text";
const NAME_TRACK_CLASS = "farm-name-track";
const SLIDING_CLASS = "is-sliding";
const SLIDE_DURATION_PROPERTY = "--slide-duration";
const SLIDE_MIN_SECONDS = 2;
const SLIDE_SECONDS_PER_PIXEL = 0.05;
const RESLIDE_DEBOUNCE_MS = 100;
const SLIDING_NAME_SELECTOR = `.${NAME_CLASS}, .${MATERIAL_NAME_CLASS}`;
const PANEL_EVENT_ID = "panel-event";

export function buildQuestName(text) {
  const name = DOMFactory.el("div", ["farm-stat", NAME_CLASS], { title: text });
  name.appendChild(buildNameText(text));
  return name;
}

/* Point a static-markup name container (a tier card's .material-name div) at the sliding shape:
   the inner span carries the text, the container the title. A name already sliding is cleared back
   to the single span first so a later event switch never leaves the duplicate behind; the next
   refresh re-measures and rebuilds the track if the new name still overflows. */
export function applySlidingName(container, text) {
  container.setAttribute("title", text);
  clearSlide(container);
  const inner = container.querySelector("." + NAME_TEXT_CLASS);
  if (inner) inner.textContent = text;
  else container.replaceChildren(buildNameText(text));
}

export function refreshSlidingNames(root) {
  installResizeWatcher();
  const scope = root || document;
  scope.querySelectorAll(SLIDING_NAME_SELECTOR).forEach(measureName);
}

function buildNameText(text) {
  const inner = DOMFactory.el("span", NAME_TEXT_CLASS);
  inner.textContent = text;
  return inner;
}

/* buildNameTrack, clearSlide and slideSeconds are exported for tests/event-shop-farm-names.test.js, which pins the
   track shape, the unwrap and the duration formula on stub nodes. Whether a name slides at all is decided by
   scrollWidth measurement — layout, so it stays behind the browser gate and out of the unit tests. */
export function buildNameTrack(text) {
  const track = DOMFactory.el("span", NAME_TRACK_CLASS);
  track.appendChild(buildNameText(text));
  const duplicate = DOMFactory.el("span", NAME_TEXT_CLASS, { "aria-hidden": "true" });
  duplicate.textContent = text;
  track.appendChild(duplicate);
  return track;
}

/* Reading scrollWidth after the slide is cleared back to the single span forces layout with the
   animation at rest, so the measurement never sees a transformed or doubled box. A container
   without the inner span (a legacy name that never went through the restructure) has nothing to
   animate — skip it. */
function measureName(name) {
  clearSlide(name);
  const inner = name.querySelector("." + NAME_TEXT_CLASS);
  if (!inner) return;
  const nameWidth = name.scrollWidth;
  if (nameWidth - name.clientWidth <= 0) return;
  startLoop(name, inner.textContent, nameWidth);
}

function startLoop(name, text, nameWidth) {
  name.replaceChildren(buildNameTrack(text));
  name.classList.add(SLIDING_CLASS);
  name.style.setProperty(SLIDE_DURATION_PROPERTY, `${slideSeconds(nameWidth)}s`);
}

/* Back to the single static span: unwrap the track's first copy (the updated name text lives
   there), drop the duplicate, strip the state class and the duration property. */
export function clearSlide(name) {
  name.classList.remove(SLIDING_CLASS);
  name.style.removeProperty(SLIDE_DURATION_PROPERTY);
  const inner = name.querySelector("." + NAME_TEXT_CLASS);
  if (inner) name.replaceChildren(inner);
}

export function slideSeconds(nameWidth) {
  return Math.round((SLIDE_MIN_SECONDS + nameWidth * SLIDE_SECONDS_PER_PIXEL) * 10) / 10;
}

let resizeWatched = false;
let reslideTimer = null;
function installResizeWatcher() {
  if (resizeWatched) return;
  resizeWatched = true;
  window.addEventListener("resize", scheduleReslide);
  observePanelReveal();
}

/* R29: names measured while #panel-event is display:none read as fitting (a zero box minus a zero
   box is no overflow). Reveal gives the panel its first box; the observer fires there — and on any
   later layout gain under the panel (farm grid un-hiding, results growing) — and the debounced pass
   re-measures the live DOM. One guard flag, one observer, one never-replaced node: nothing
   accumulates across replaceChildren re-renders. Browsers without ResizeObserver keep the
   pre-R29 behavior — correct measurement whenever a render happens while the panel is visible. */
function observePanelReveal() {
  if (typeof ResizeObserver !== "function") return;
  const panel = document.getElementById(PANEL_EVENT_ID);
  if (panel) new ResizeObserver(scheduleReslide).observe(panel);
}

function scheduleReslide() {
  clearTimeout(reslideTimer);
  reslideTimer = setTimeout(() => refreshSlidingNames(document), RESLIDE_DEBOUNCE_MS);
}
