import { DEBOUNCE_MS } from "./constants.js";
import { CEById, ServantData } from "./data.js";

export const DOMFactory = {
  el(tag, className, attrs = {}) {
    const element = document.createElement(tag);
    if (className) {
      if (Array.isArray(className)) {
        className.forEach((c) => element.classList.add(c));
      } else {
        element.className = className;
      }
    }
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === "dataset") {
        Object.entries(value).forEach(([k, v]) => {
          element.dataset[k] = v;
        });
      } else {
        element.setAttribute(key, value);
      }
    });
    return element;
  },

  createLazyImg(src, className, attrs = {}) {
    const img = this.el("img", className, { src, ...attrs });
    if (!attrs.loading) {
      img.loading = "lazy";
    }
    img.decoding = "async";
    return img;
  },

  appendCheckMark(parent) {
    const check = this.el("div", "ce-filter-check");
    check.textContent = "\u2713";
    parent.appendChild(check);
  },

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  },

  addSimpleFallback(img, cssClass, text) {
    img.onerror = () => {
      const fb = this.el("div", cssClass);
      fb.textContent = text;
      img.replaceWith(fb);
    };
  },

  addAscensionFallback(img, fallbackText) {
    img.onerror = () => {
      const fb = this.el("div", "servant-slot-portrait-fallback");
      fb.textContent = fallbackText;
      img.replaceWith(fb);
    };
  },
};

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export const CollapsibleFactory = {
  build(title, content) {
    const wrapper = DOMFactory.el("div", "filter collapsed");
    const header = DOMFactory.el("div", "filter-header");
    const label = DOMFactory.el("span", "");
    label.textContent = title;
    const arrow = DOMFactory.el("span", "filter-arrow");
    arrow.textContent = "\u25BC";
    header.appendChild(label);
    header.appendChild(arrow);
    header.addEventListener("click", () => {
      wrapper.classList.toggle("collapsed");
      // On first open, promote data-src → src for deferred images
      if (!wrapper.classList.contains("collapsed")) {
        content.querySelectorAll("img[data-src]").forEach((img) => {
          img.src = img.dataset.src;
          img.removeAttribute("data-src");
        });
      }
    });
    wrapper.appendChild(header);
    wrapper.appendChild(content);
    return wrapper;
  },

  createSearchInput(query, onSearch) {
    const searchInput = DOMFactory.el("input", "search-filter");
    searchInput.type = "text";
    searchInput.placeholder = "Search by ID or name...";
    searchInput.value = query;
    const debouncedSearch = debounce(onSearch, DEBOUNCE_MS);
    searchInput.addEventListener("input", (e) => {
      debouncedSearch(e.target.value);
    });
    return searchInput;
  },

  populateFilterArea(container, query, onSearch, buildExtra) {
    container.replaceChildren();
    const content = DOMFactory.el("div", "filter-content");
    content.appendChild(CollapsibleFactory.createSearchInput(query, onSearch));
    const group = DOMFactory.el("div", "filter-group");
    if (buildExtra) buildExtra(group);
    content.appendChild(group);
    container.appendChild(CollapsibleFactory.build("Filters", content));
  },
};

export const ComboCardRenderer = {
  buildServantCell(entry, rowCEs) {
    const servant = entry.servant;
    const { imgSrc, fullName } = ServantData.resolveEntryDisplay(entry, rowCEs);
    const cell = DOMFactory.el("div", "cefilter-combo-servant");
    const img = DOMFactory.createLazyImg(imgSrc, ["cefilter-match-badge", "cefilter-combo-servant-badge"], {
      alt: fullName,
      title: fullName,
    });
    DOMFactory.addAscensionFallback(img, servant.id);
    cell.appendChild(img);
    return cell;
  },

  buildCard(group, options = {}) {
    const { onSelectCE, membersKey = "members" } = options;
    const card = DOMFactory.el("div", ["cefilter-servant-card", "cefilter-combo-card"]);

    const ceRow = DOMFactory.el("div", ["ce-badges", "cefilter-combo-ce-row"]);
    group.ceIds.forEach((ceId) => {
      const ce = CEById.get(ceId);
      if (!ce) return;
      const isInteractive = typeof onSelectCE === "function";
      const cell = DOMFactory.el(
        isInteractive ? "button" : "div",
        "cefilter-combo-ce",
        isInteractive
          ? {
              type: "button",
              "aria-label": `Select ${ce.name} in Craft Essence Select`,
              title: ce.name,
            }
          : { title: ce.name },
      );
      const img = DOMFactory.createLazyImg(ce.thumbImage, "cefilter-combo-ce-img", { alt: ce.name, title: ce.name });
      DOMFactory.addSimpleFallback(img, "cefilter-match-badge-fallback", ce.id);
      cell.appendChild(img);
      if (isInteractive) {
        cell.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectCE(ceId);
        });
      }
      ceRow.appendChild(cell);
    });
    card.appendChild(ceRow);

    const servantRow = DOMFactory.el("div", ["ce-badges", "cefilter-combo-servant-row"]);
    const rowCEs = group.ceIds.map((ceId) => CEById.get(ceId)).filter(Boolean);
    const members = group[membersKey] || [];
    members.forEach((entry) => {
      if (!entry || !entry.servant) return;
      servantRow.appendChild(this.buildServantCell(entry, rowCEs));
    });
    card.appendChild(servantRow);

    return card;
  },
};

export { debounce };
