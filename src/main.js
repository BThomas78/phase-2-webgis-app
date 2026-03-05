import "./style.css";
import "@arcgis/core/assets/esri/themes/light/main.css";

import esriConfig from "@arcgis/core/config.js";
import MapView from "@arcgis/core/views/MapView.js";
import WebMap from "@arcgis/core/WebMap.js";

import LayerList from "@arcgis/core/widgets/LayerList.js";
import Legend from "@arcgis/core/widgets/Legend.js";
import Search from "@arcgis/core/widgets/Search.js";
import Expand from "@arcgis/core/widgets/Expand.js";

const statusEl = document.getElementById("status");
const copyBtn = document.getElementById("copyLinkBtn");

console.log("copyBtn found?", !!copyBtn);

function setStatus(msg) {
  statusEl.textContent = msg;
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function applyUrlViewState(cfg) {
  const params = new URLSearchParams(window.location.search);

  const centerStr = params.get("center");

  // center
  let center = cfg.center ?? [-89.3985, 40.6331];
  if (centerStr) {
    const parts = centerStr.split(",").map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      center = [clamp(parts[0], -180, 180), clamp(parts[1], -90, 90)];
    }
  }

  // zoom (only if valid >= 0)
  const zoomStr = params.get("zoom");
  let zoom = null;
  if (zoomStr !== null) {
    const z = Number(zoomStr);
    if (Number.isFinite(z) && z >= 0) zoom = clamp(Math.round(z), 0, 23);
  }

  // scale (fallback, always valid)
  const scaleStr = params.get("scale");
  let scale = null;
  if (scaleStr !== null) {
    const s = Number(scaleStr);
    if (Number.isFinite(s) && s > 0) scale = Math.round(s);
  }

  // Default if neither is provided
  if (zoom === null && scale === null) zoom = cfg.zoom ?? 6;

  return { center, zoom, scale };
}

async function loadConfig() {
  const res = await fetch(`${import.meta.env.BASE_URL}config.json`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load config.json (${res.status})`);
  return res.json();
}

async function main() {
  setStatus("Loading config…");
  const cfg = await loadConfig();

  if (cfg.portalUrl) esriConfig.portalUrl = cfg.portalUrl;
  if (!cfg.webmapItemId) throw new Error("config.json missing webmapItemId");

  setStatus("Loading WebMap…");
  const webmap = new WebMap({
    portalItem: { id: cfg.webmapItemId },
  });

  // Load the portal item first (public WebMap should load without a key)
  await webmap.load();

  // Optional API key (for premium services like geocoding/basemaps)
  const apiKey = import.meta.env.VITE_ARCGIS_API_KEY;
  if (apiKey) esriConfig.apiKey = apiKey;

  const { center, zoom, scale } = applyUrlViewState(cfg);

  const viewOptions = {
    container: "viewDiv",
    map: webmap,
    center,
  };

  if (zoom !== null) viewOptions.zoom = zoom;
  else if (scale !== null) viewOptions.scale = scale;

  setStatus("Creating view…");
  const view = new MapView(viewOptions);

  // Widgets
  view.ui.add(new Search({ view }), "top-right");

  // ✅ LayerList actions allowed only for these portal item IDs
  const ACTION_PORTALITEM_IDS = new Set([
    "f193a89113fa43a6ae9c4482b2d9c1d3",
    "88e08b054f834d25a3d215497674f94d",
    "45473913f9504373a1e532ebd8fdf663",
  ]);

  function isActionLayer(layer) {
    const pid = layer?.portalItem?.id;
    return !!pid && ACTION_PORTALITEM_IDS.has(pid);
  }

  const layerList = new LayerList({
    view,
    listItemCreatedFunction: (event) => {
      const item = event.item;
      const layer = item.layer;
      if (!layer) return;

      if (!isActionLayer(layer)) return;

      item.actionsSections = [
        [
          {
            title: "Zoom to layer",
            id: "zoom-to-layer",
            className: "esri-icon-zoom-in-magnifying-glass",
          },
          {
            title: "Toggle labels",
            id: "toggle-labels",
            className: "esri-icon-annotation",
          },
        ],
      ];
    },
  });

  const legend = new Legend({ view });

  view.ui.add(
    new Expand({ view, content: layerList, group: "top-left" }),
    "top-left",
  );
  view.ui.add(
    new Expand({ view, content: legend, group: "top-left" }),
    "top-left",
  );

  await view.when();
  setStatus("Ready ✅ (click the map)");

  // Keep URL in sync with view (use scale; only write zoom if valid)
  view.watch("stationary", (isStationary) => {
    if (!isStationary) return;

    const c = view.center;
    const url = new URL(window.location.href);

    url.searchParams.set(
      "center",
      `${c.longitude.toFixed(5)},${c.latitude.toFixed(5)}`,
    );

    url.searchParams.set("scale", String(Math.round(view.scale)));

    if (Number.isFinite(view.zoom) && view.zoom >= 0) {
      url.searchParams.set("zoom", String(Math.round(view.zoom)));
    } else {
      url.searchParams.delete("zoom");
    }

    window.history.replaceState({}, "", url);
  });

  // Copy link (use scale; only include zoom if valid)
  copyBtn?.addEventListener("click", async () => {
    const c = view.center;
    const url = new URL(window.location.href);

    url.searchParams.set(
      "center",
      `${c.longitude.toFixed(5)},${c.latitude.toFixed(5)}`,
    );

    url.searchParams.set("scale", String(Math.round(view.scale)));

    if (Number.isFinite(view.zoom) && view.zoom >= 0) {
      url.searchParams.set("zoom", String(Math.round(view.zoom)));
    } else {
      url.searchParams.delete("zoom");
    }

    try {
      await navigator.clipboard.writeText(url.toString());
      setStatus("Link copied ✅");
      setTimeout(() => setStatus("Ready ✅ (click the map)"), 1200);
    } catch {
      window.prompt("Copy this link:", url.toString());
    }
  });

  // LayerList action handler
  layerList.on("trigger-action", async (event) => {
    const layer = event.item?.layer;
    if (!layer) return;
    if (!isActionLayer(layer)) return;

    if (event.action.id === "zoom-to-layer") {
      try {
        await layer.load();

        if (layer.fullExtent) {
          await view.goTo(layer.fullExtent.expand(1.2));
        } else if (layer.queryExtent) {
          const { extent } = await layer.queryExtent();
          if (extent) await view.goTo(extent.expand(1.2));
          else setStatus("No extent available");
        } else {
          setStatus("No extent method");
        }
      } catch (e) {
        console.error(e);
        setStatus("Zoom failed");
      }
    }

    if (event.action.id === "toggle-labels") {
      if ("labelsVisible" in layer) {
        layer.labelsVisible = !layer.labelsVisible;
        setStatus(`Labels: ${layer.labelsVisible ? "ON" : "OFF"}`);
      } else {
        setStatus("This layer has no labels");
      }
    }
  });

  // Loading indicator (don’t override identify)
  view.watch("updating", (isUpdating) => {
    const current = statusEl.textContent || "";
    const isIdentifying = current.startsWith("Identifying");
    if (isIdentifying) return;

    if (isUpdating) setStatus("Updating…");
    else setStatus("Ready ✅ (click the map)");
  });

  // Click-to-identify
  view.on("click", async (event) => {
    try {
      setStatus("Identifying…");
      const hit = await view.hitTest(event);

      const results = (hit.results || []).filter(
        (r) => r.graphic && r.graphic.layer,
      );

      if (!results.length) {
        setStatus("Ready ✅ (no feature hit)");
        return;
      }

      const top =
        results.find((r) => r.graphic.layer?.type === "feature") ?? results[0];

      const layerTitle = top.graphic.layer?.title ?? "Layer";
      const attrs = top.graphic.attributes ?? {};

      console.log("Hit layer:", layerTitle);
      console.log("Attributes:", attrs);
      setStatus(`Ready ✅ (hit: ${layerTitle})`);
    } catch (e) {
      console.error(e);
      setStatus("Ready ✅ (identify error)");
    }
  });
}

main().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message}`);
});
