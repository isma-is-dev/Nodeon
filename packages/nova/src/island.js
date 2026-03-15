const islands = new Map();
let islandCounter = 0;
function island(ComponentClass, opts) {
  const strategy = opts && opts.strategy || "load";
  const media = opts && opts.media || null;
  const id = "island-" + islandCounter++;
  ComponentClass._island = { id: id, name: ComponentClass.name || id, strategy: strategy, media: media };
  islands.set(id, ComponentClass);
  return ComponentClass;
}
function renderIsland(ComponentClass, props) {
  const meta = ComponentClass._island;
  if (!meta) {
    throw new Error(ComponentClass.name + " is not an island component. Use island() to register it.");
  }
  const instance = new ComponentClass();
  if (props) {
    for (const key of Object.keys(props)) {
      instance[key] = props[key];
    }
  }
  let html = "";
  if (typeof instance.template === "function") {
    html = instance.template();
  }
  const propsJson = (() => { if (props) { return escapeAttr(JSON.stringify(props)); } else { return "{}"; } })();
  const attrs = ["data-island=\"" + meta.id + "\"", "data-island-name=\"" + meta.name + "\"", "data-island-strategy=\"" + meta.strategy + "\"", "data-island-props=\"" + propsJson + "\""];
  if (meta.media) {
    attrs.push("data-island-media=\"" + escapeAttr(meta.media) + "\"");
  }
  return "<nova-island " + attrs.join(" ") + ">" + html + "</nova-island>";
}
function generateHydrationScript(islandIds, opts) {
  const baseUrl = opts && opts.baseUrl || "/_nova/islands/";
  if (islandIds.length === 0) {
    return "";
  }
  const imports = islandIds.map(id => {
    const meta = islands.get(id);
    const name = (() => { if (meta) { return meta._island.name; } else { return id; } })();
    return "  \"" + id + "\": () => import(\"" + baseUrl + id + ".js\")";
  }).join(",\n");
  return "<script type=\"module\">\n" + HYDRATION_RUNTIME + "\n\nconst islandModules = \\{\n" + imports + "\n\\};\n\nhydrateIslands(islandModules);\n</script>";
}
function extractIslandIds(html) {
  const ids = [];
  const regex = /data-island="([^"]+)"/g;
  let matched = regex.exec(html);
  while (matched !== null) {
    if (ids.indexOf(matched[1]) === -1) {
      ids.push(matched[1]);
    }
    matched = regex.exec(html);
  }
  return ids;
}
function injectIslandScripts(html, opts) {
  const islandIds = extractIslandIds(html);
  if (islandIds.length === 0) {
    return html;
  }
  const script = generateHydrationScript(islandIds, opts);
  if (html.includes("</body>")) {
    return html.replace("</body>", script + "\n</body>");
  }
  return html + "\n" + script;
}
const HYDRATION_RUNTIME = `
// Nova hydration runtime — runs in the browser
async function hydrateIslands(modules) {
  const islands = document.querySelectorAll('nova-island[data-island]');

  for (const el of islands) {
    const id = el.getAttribute('data-island');
    const strategy = el.getAttribute('data-island-strategy') || 'load';
    const propsStr = el.getAttribute('data-island-props') || '{}';
    const media = el.getAttribute('data-island-media');

    const loader = modules[id];
    if (!loader) continue;

    switch (strategy) {
      case 'load':
        await hydrateElement(el, loader, propsStr);
        break;

      case 'visible':
        observeVisible(el, loader, propsStr);
        break;

      case 'idle':
        if ('requestIdleCallback' in window) {
          requestIdleCallback(() => hydrateElement(el, loader, propsStr));
        } else {
          setTimeout(() => hydrateElement(el, loader, propsStr), 200);
        }
        break;

      case 'media':
        if (media && window.matchMedia) {
          const mql = window.matchMedia(media);
          if (mql.matches) {
            await hydrateElement(el, loader, propsStr);
          } else {
            mql.addEventListener('change', function handler(e) {
              if (e.matches) {
                mql.removeEventListener('change', handler);
                hydrateElement(el, loader, propsStr);
              }
            });
          }
        }
        break;

      case 'none':
        // Server-render only — no hydration
        break;
    }
  }
}

async function hydrateElement(el, loader, propsStr) {
  try {
    const mod = await loader();
    const Component = mod.default || mod;
    const props = JSON.parse(propsStr);
    const instance = new Component();

    // Apply props
    for (const [key, val] of Object.entries(props)) {
      instance[key] = val;
    }

    // Bind event listeners
    if (typeof instance.mount === 'function') {
      instance.mount(el, props);
    }

    el.setAttribute('data-hydrated', 'true');
  } catch (err) {
    console.error('[Nova] Failed to hydrate island:', el.getAttribute('data-island-name'), err);
  }
}

function observeVisible(el, loader, propsStr) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        observer.disconnect();
        hydrateElement(el, loader, propsStr);
      }
    }
  });
  observer.observe(el);
}
`.trim();
function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export { island, renderIsland, generateHydrationScript, extractIslandIds, injectIslandScripts, islands, HYDRATION_RUNTIME };