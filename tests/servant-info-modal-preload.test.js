import { test } from "node:test";
import assert from "node:assert/strict";

const elements = new Map();
const createdImages = [];
let imageBehavior = "load"; // "load" | "error" | "manual" | "decodeReject"

function createMockElement(tag) {
  let _className = "";
  const el = {
    tagName: tag.toUpperCase(),
    textContent: "",
    hidden: false,
    disabled: false,
    tabIndex: 0,
    dataset: {},
    style: {},
    children: [],
    attributes: {},
    complete: false,
    naturalWidth: 0,
    onload: null,
    onerror: null,
    classList: {
      _classes: new Set(),
      add(...cls) {
        cls.forEach((c) => this._classes.add(c));
        _className = [...this._classes].join(" ");
      },
      remove(...cls) {
        cls.forEach((c) => this._classes.delete(c));
        _className = [...this._classes].join(" ");
      },
      toggle(c, force) {
        const next = force !== undefined ? Boolean(force) : !this._classes.has(c);
        if (next) this._classes.add(c);
        else this._classes.delete(c);
        _className = [...this._classes].join(" ");
      },
      contains(c) {
        return this._classes.has(c);
      },
    },
    setAttribute(k, v) {
      this.attributes[k] = v;
      if (this.tagName === "IMG" && k === "src") {
        createdImages.push(this);
        if (imageBehavior === "load") {
          queueMicrotask(() => {
            this.complete = true;
            this.naturalWidth = 512;
            if (typeof this.onload === "function") this.onload();
          });
        } else if (imageBehavior === "error") {
          queueMicrotask(() => {
            this.complete = true;
            this.naturalWidth = 0;
            if (typeof this.onerror === "function") this.onerror();
          });
        } else if (imageBehavior === "decodeReject") {
          this.decode = () => Promise.reject(new Error("decode failed"));
          queueMicrotask(() => {
            this.complete = true;
            this.naturalWidth = 512;
            if (typeof this.onload === "function") this.onload();
          });
        }
      }
    },
    getAttribute(k) {
      return this.attributes[k];
    },
    removeAttribute(k) {
      delete this.attributes[k];
    },
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    },
    appendChild(child) {
      this.append(child);
    },
    append(...nodes) {
      for (const n of nodes) {
        if (n && n.nodeType === 11) {
          this.children.push(...n.children);
          n.children = [];
        } else if (n) {
          this.children.push(n);
        }
      }
    },
    addEventListener() {},
    focus() {},
    querySelectorAll() {
      return [];
    },
  };
  Object.defineProperty(el, "className", {
    get() {
      return _className;
    },
    set(val) {
      _className = val;
      el.classList._classes = new Set(String(val).split(" ").filter(Boolean));
    },
  });
  return el;
}

function getMockElement(id) {
  if (!elements.has(id)) {
    const el = createMockElement("div");
    el.id = id;
    elements.set(id, el);
  }
  return elements.get(id);
}

globalThis.document = {
  getElementById: (id) => getMockElement(id),
  createElement: (tag) => createMockElement(tag),
  createTextNode: (text) => ({ textContent: text }),
  createDocumentFragment: () => ({
    nodeType: 11,
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  }),
  addEventListener: () => {},
  activeElement: null,
};

test("_collectModalImageUrls: collects and deduplicates Saint Graphs, base/alt portraits, stage faces, and formConfig faces", async () => {
  const { IMAGE_VERSION } = await import("../src/scripts/constants.js");
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");

  const baseServant = {
    id: "505600",
    name: "François Prélat",
    image: `servants/505600/000.webp?v=${IMAGE_VERSION}`,
    altImage: `servants/505700/000.webp?v=${IMAGE_VERSION}`,
  };

  const svt = {
    id: 505600,
    saintGraphs: [
      { file: "505600a@1.webp", face: "505600/000.webp" },
      { file: "505600a@2.webp", face: "505600/001.webp" },
      { file: "505600a@1.webp", face: "505600/000.webp" }, // duplicate
      { file: "505700a@1.webp", face: "505700/000.webp" },
      { file: "505730a.webp", face: "505700/c_505730.webp" },
    ],
    formatted: {
      formConfig: {
        0: { index: 0, label: "Form 0" },
        1: {
          index: 1,
          label: "Form 1",
          faces: {
            1: "600710/000.webp",
            2: "600710/001.webp",
            3: "600710/000.webp", // duplicate
          },
        },
      },
    },
  };

  const urls = ServantInfoApp._collectModalImageUrls(svt, baseServant);
  const expected = [
    `servants/505600/000.webp?v=${IMAGE_VERSION}`,
    `servants/505700/000.webp?v=${IMAGE_VERSION}`,
    `saint_graphs/505600a@1.webp?v=${IMAGE_VERSION}`,
    `saint_graphs/505600a@2.webp?v=${IMAGE_VERSION}`,
    `servants/505600/001.webp?v=${IMAGE_VERSION}`,
    `saint_graphs/505700a@1.webp?v=${IMAGE_VERSION}`,
    `saint_graphs/505730a.webp?v=${IMAGE_VERSION}`,
    `servants/505700/c_505730.webp?v=${IMAGE_VERSION}`,
    `servants/600710/000.webp?v=${IMAGE_VERSION}`,
    `servants/600710/001.webp?v=${IMAGE_VERSION}`,
  ];

  assert.deepEqual(urls, expected);
  assert.equal(new Set(urls).size, urls.length, "URLs must be deduplicated");
});

test("_preloadImageUrl: caches promises per URL and resolves gracefully on error or decode rejection", async () => {
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");

  ServantInfoApp._imagePreloadCache.clear();
  createdImages.length = 0;

  imageBehavior = "load";
  const p1 = ServantInfoApp._preloadImageUrl("servants/100100/000.webp?v=test");
  const p2 = ServantInfoApp._preloadImageUrl("servants/100100/000.webp?v=test");
  assert.equal(p1, p2, "Repeated preload for same URL must reuse cached promise");
  await p1;
  assert.equal(createdImages.length, 1, "Only one <img> element created for cached URL");

  imageBehavior = "error";
  await ServantInfoApp._preloadImageUrl("servants/missing/404.webp?v=test");

  imageBehavior = "decodeReject";
  await ServantInfoApp._preloadImageUrl("saint_graphs/corrupt.webp?v=test");
});

test("_openDetailModal: stays in loading state until JSON and all images finish preloading, and guards against stale renders", async () => {
  const { IMAGE_VERSION } = await import("../src/scripts/constants.js");
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");

  ServantInfoApp._infoCache.clear();
  ServantInfoApp._imagePreloadCache.clear();
  createdImages.length = 0;
  imageBehavior = "manual";

  const modal = getMockElement("servantInfoModal");
  const titleEl = getMockElement("servantInfoModalTitle");
  const bodyEl = getMockElement("servantInfoModalBody");
  getMockElement("servantInfoModalClose");

  const servant = {
    id: "100100",
    collectionNo: 2,
    name: "Altria Pendragon",
    image: `servants/100100/000.webp?v=${IMAGE_VERSION}`,
  };

  const payload = {
    id: 100100,
    collectionNo: 2,
    name: "Altria Pendragon",
    originalName: "アルトリア・ペンドラゴン",
    className: "Saber",
    rarity: 5,
    cost: 16,
    saintGraphs: [
      { key: "1", label: "1st Ascension", file: "100100a@1.webp", kind: "ascension", form: 0, face: "100100/000.webp" },
      { key: "2", label: "2nd Ascension", file: "100100a@2.webp", kind: "ascension", form: 0, face: "100100/001.webp" },
    ],
    formatted: { profile: { forms: [] }, slots: [] },
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  });

  try {
    const openPromise = ServantInfoApp._openDetailModal(servant);

    // Wait a tick for fetch() to resolve and image preloading to start
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(modal.classList.contains("open"), true);
    assert.equal(titleEl.textContent, "No.002 Altria Pendragon");
    assert.equal(bodyEl.children.length, 1);
    assert.equal(
      bodyEl.children[0].classList.contains("servant-info-loading"),
      true,
      "Modal must remain in loading state while images are still preloading",
    );
    assert.equal(createdImages.length, 4, "Should preload 2 Saint Graphs + 2 deduplicated face icons");

    // Finish loading the first 3 images — modal must STILL be in loading state
    for (let i = 0; i < 3; i++) {
      createdImages[i].onload();
    }
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      bodyEl.children[0].classList.contains("servant-info-loading"),
      true,
      "Modal must still show loading state when 1 image has not settled",
    );

    // Settle the 4th image (even with onerror) -> modal renders content
    createdImages[3].onerror();
    await openPromise;

    assert.equal(
      bodyEl.children[0].classList.contains("servant-info-loading"),
      false,
      "Modal must replace loading state after all images settle",
    );
    assert.equal(bodyEl.children[0].classList.contains("servant-info-hero"), true);

    // Repeat open with warm _infoCache + _imagePreloadCache renders without spawning duplicate image requests
    const preloadImgsBeforeRepeat = createdImages.filter((img) => typeof img.onload === "function").length;
    await ServantInfoApp._openDetailModal(servant);
    const preloadImgsAfterRepeat = createdImages.filter((img) => typeof img.onload === "function").length;
    assert.equal(
      preloadImgsAfterRepeat,
      preloadImgsBeforeRepeat,
      "Repeat open must reuse cached image preload promises",
    );

    // Stale render guard: closing modal while preloading prevents render
    ServantInfoApp._infoCache.clear();
    ServantInfoApp._imagePreloadCache.clear();
    createdImages.length = 0;
    const staleOpen = ServantInfoApp._openDetailModal(servant);
    await new Promise((r) => setTimeout(r, 10));
    ServantInfoApp._closeDetailModal();
    createdImages.forEach((img) => img.onload && img.onload());
    await staleOpen;
    assert.equal(modal.classList.contains("open"), false);
    assert.equal(
      bodyEl.children[0].classList.contains("servant-info-loading"),
      true,
      "Closed modal must not render detail content after stale preload finishes",
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});
