import { injectIslandScripts } from "./island.js";
async function renderPage(pageMod, params, opts) {
  const page = pageMod.default || pageMod;
  if (typeof page === "function" && page.prototype && page.prototype.template) {
    const instance = new page();
    let data = {};
    if (typeof instance.load === "function") {
      data = await instance.load(params) || {};
    }
    let html = instance.template(data, params);
    if (typeof instance.style === "function") {
      const css = instance.style();
      if (css) {
        html = injectStyle(html, css);
      }
    }
    if (instance.constructor._layout) {
      html = await renderLayout(instance.constructor._layout, html);
    }
    return html;
  }
  if (typeof page === "function") {
    return await page(params);
  }
  if (typeof page === "string") {
    return page;
  }
  throw new Error("Page module must export a class with template() or a function");
}
async function renderLayout(LayoutClass, content) {
  const layout = new LayoutClass();
  return layout.template(content);
}
function injectStyle(html, css) {
  const styleTag = "<style>" + css + "</style>";
  if (html.includes("</head>")) {
    return html.replace("</head>", styleTag + "</head>");
  }
  return styleTag + html;
}
function wrapHtmlShell(html, title) {
  if (html.includes("<html") || html.includes("<!DOCTYPE") || html.includes("<!doctype")) {
    return html;
  }
  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>" + (title || "Nova") + "</title>\n</head>\n<body>\n" + html + "\n</body>\n</html>";
}
function postProcess(html, opts) {
  return injectIslandScripts(html, opts);
}
export { renderPage, renderLayout, injectStyle, wrapHtmlShell, postProcess };