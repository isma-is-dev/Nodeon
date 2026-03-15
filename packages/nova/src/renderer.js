// Nova static renderer
// Takes page modules and renders them to HTML strings.
//
// Page modules export:
//   - default class or function that returns HTML
//   - optional load() for data fetching
//   - optional layout reference

/**
 * Render a page module to an HTML string.
 * @param {object} pageMod - The loaded page module
 * @param {object} params - Route params (e.g. { slug: "hello" })
 * @param {object} opts - Render options
 * @returns {Promise<string>} HTML string
 */
async function renderPage(pageMod, params, opts) {
  const page = pageMod.default || pageMod;

  // If it's a class with template(), instantiate
  if (typeof page === "function" && page.prototype && page.prototype.template) {
    const instance = new page();

    // Run load() if present — data loading phase
    let data = {};
    if (typeof instance.load === "function") {
      data = await instance.load(params) || {};
    }

    // Render template
    let html = instance.template(data, params);

    // Extract and inject styles
    if (typeof instance.style === "function") {
      const css = instance.style();
      if (css) {
        html = injectStyle(html, css);
      }
    }

    // Wrap in layout if specified
    if (instance.constructor._layout) {
      html = await renderLayout(instance.constructor._layout, html);
    }

    return html;
  }

  // If it's a plain function, call it
  if (typeof page === "function") {
    return await page(params);
  }

  // If it's a string, return as-is
  if (typeof page === "string") {
    return page;
  }

  throw new Error("Page module must export a class with template() or a function");
}

/**
 * Render a layout, inserting page content into the slot.
 */
async function renderLayout(LayoutClass, content) {
  const layout = new LayoutClass();
  return layout.template(content);
}

/**
 * Inject a <style> block into HTML.
 * If <head> exists, inject there; otherwise prepend.
 */
function injectStyle(html, css) {
  const styleTag = "<style>" + css + "</style>";
  if (html.includes("</head>")) {
    return html.replace("</head>", styleTag + "</head>");
  }
  return styleTag + html;
}

/**
 * Wrap content in a minimal HTML shell if not already a full document.
 */
function wrapHtmlShell(html, title) {
  if (html.includes("<html") || html.includes("<!DOCTYPE") || html.includes("<!doctype")) {
    return html;
  }
  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>" + (title || "Nova") + "</title>\n</head>\n<body>\n" + html + "\n</body>\n</html>";
}

module.exports = { renderPage, renderLayout, injectStyle, wrapHtmlShell };
