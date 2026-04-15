import { DEBOUNCE_MS } from "./constants.js";

export const DOMFactory = {
  el(tag, className, attrs = {}) {
    const element = document.createElement(tag);
    if (className) {
      if (Array.isArray(className)) {
        className.forEach(c => element.classList.add(c));
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
  }
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
    const wrapper = DOMFactory.el("div", "ceoverlap-collapsible collapsed");
    const header = DOMFactory.el("div", "ceoverlap-collapsible-header");
    const label = DOMFactory.el("span", "");
    label.textContent = title;
    const arrow = DOMFactory.el("span", "ceoverlap-collapsible-arrow");
    arrow.textContent = "\u25BC";
    header.appendChild(label);
    header.appendChild(arrow);
    header.addEventListener("click", () => {
      wrapper.classList.toggle("collapsed");
    });
    wrapper.appendChild(header);
    wrapper.appendChild(content);
    return wrapper;
  },

  createSearchInput(query, onSearch) {
    const searchInput = DOMFactory.el("input", "servant-search ceoverlap-search");
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
    const content = DOMFactory.el("div", "ceoverlap-collapsible-content");
    content.appendChild(CollapsibleFactory.createSearchInput(query, onSearch));
    if (buildExtra) buildExtra(content);
    container.appendChild(CollapsibleFactory.build("Filters", content));
  }
};

export { debounce };
