import { test } from "node:test";
import assert from "node:assert/strict";

/* Minimal stub DOM for event-shop-farm-names.js: only the surface the module actually touches — createElement,
   className/classList, setAttribute/getAttribute, appendChild/replaceChildren and querySelector over ".class"
   selectors. Pixel layout (scrollWidth/clientWidth) is deliberately NOT stubbed: deciding whether a name slides
   at all is a browser-gate concern, so these tests pin only the pure logic — the duration formula, the track
   shape and the unwrap. */
function matchesClass(node, wanted) {
  return node.className.split(" ").includes(wanted) || node.classList.contains(wanted);
}

function queryTree(node, selector) {
  const wanted = selector.replace(/^\./, "");
  for (const child of node.children) {
    if (matchesClass(child, wanted)) return child;
    const found = queryTree(child, selector);
    if (found) return found;
  }
  return null;
}

function newStubElement(tag) {
  const classes = new Set();
  const attributes = {};
  const styleProperties = {};
  return {
    tagName: tag.toUpperCase(),
    className: "",
    textContent: "",
    children: [],
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    style: {
      setProperty: (name, value) => {
        styleProperties[name] = value;
      },
      removeProperty: (name) => {
        delete styleProperties[name];
      },
      getPropertyValue: (name) => (name in styleProperties ? styleProperties[name] : ""),
    },
    setAttribute: (name, value) => {
      attributes[name] = String(value);
    },
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    querySelector(selector) {
      return queryTree(this, selector);
    },
  };
}

globalThis.document = { createElement: (tag) => newStubElement(tag) };
const { slideSeconds, buildNameTrack, clearSlide } = await import("../src/scripts/event-shop-farm-names.js");

test("slideSeconds: 2s floor, 0.05s per name-pixel, rounded to one decimal", () => {
  assert.equal(slideSeconds(0), 2);
  assert.equal(slideSeconds(60), 5);
  assert.equal(slideSeconds(100), 7);
  assert.equal(slideSeconds(200), 12);
  // exact tenths needing the implementer's round: true values 3.65 and 12.75
  assert.equal(slideSeconds(33), 3.7);
  assert.equal(slideSeconds(215), 12.8);
});

test("buildNameTrack: the name twice inside one track, duplicate hidden from aria", () => {
  const track = buildNameTrack("Tenetera Gaze");
  assert.equal(track.className, "farm-name-track");
  assert.equal(track.children.length, 2);
  const [original, duplicate] = track.children;
  assert.equal(original.className, "farm-quest-name-text");
  assert.equal(original.textContent, "Tenetera Gaze");
  assert.equal(original.getAttribute("aria-hidden"), null);
  assert.equal(duplicate.className, "farm-quest-name-text");
  assert.equal(duplicate.textContent, "Tenetera Gaze");
  assert.equal(duplicate.getAttribute("aria-hidden"), "true");
  // the gap between the copies is the CSS padding-inline-end, not a third node
});

test("clearSlide: unwraps the track's first copy, drops the class and the duration", () => {
  const name = newStubElement("div");
  name.className = "material-name";
  const track = buildNameTrack("Giant Kochab Horn");
  name.replaceChildren(track);
  name.classList.add("is-sliding");
  name.style.setProperty("--slide-duration", "12.8s");

  clearSlide(name);

  assert.equal(name.children.length, 1);
  assert.equal(name.children[0], track.children[0]);
  assert.equal(name.children[0].className, "farm-quest-name-text");
  assert.equal(name.children[0].textContent, "Giant Kochab Horn");
  assert.equal(name.classList.contains("is-sliding"), false);
  assert.equal(name.style.getPropertyValue("--slide-duration"), "");
});

test("clearSlide on a resting single-span name keeps that span and its text", () => {
  const name = newStubElement("div");
  const inner = newStubElement("span");
  inner.className = "farm-quest-name-text";
  inner.textContent = "Marsh Marigold";
  name.replaceChildren(inner);

  clearSlide(name);

  assert.equal(name.children.length, 1);
  assert.equal(name.children[0], inner);
  assert.equal(name.children[0].textContent, "Marsh Marigold");
});
