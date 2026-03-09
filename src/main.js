import "./style.css";
import "@arcgis/core/assets/esri/themes/light/main.css";

import Map from "@arcgis/core/Map.js";
import MapView from "@arcgis/core/views/MapView.js";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";

import LayerList from "@arcgis/core/widgets/LayerList.js";
import Legend from "@arcgis/core/widgets/Legend.js";
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

  let center = cfg.center ?? [-89.3985, 40.6331];
  if (centerStr) {
    const parts = centerStr.split(",").map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      center = [clamp(parts[0], -180, 180), clamp(parts[1], -90, 90)];
    }
  }

  const zoomStr = params.get("zoom");
  let zoom = null;
  if (zoomStr !== null) {
    const z = Number(zoomStr);
    if (Number.isFinite(z) && z >= 0) zoom = clamp(Math.round(z), 0, 23);
  }

  const scaleStr = params.get("scale");
  let scale = null;
  if (scaleStr !== null) {
    const s = Number(scaleStr);
    if (Number.isFinite(s) && s > 0) scale = Math.round(s);
  }

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

const sharedPopupTemplate = {
  title: "Low Access and Low Income Tracts",
  expressionInfos: [
    {
      name: "expr0",
      title: "Low Access",
      expression: `
        var v = $feature["IS_LOWACC_TRACT"];
        if (IsEmpty(v)) return "N/A";
        if (Number(v) == 1) return "YES";
        if (Number(v) == 0) return "NO";
        return "N/A";
      `,
    },
    {
      name: "expr1",
      title: "Median Family Income (Tract)",
      expression: `
        var raw = $feature["Census_Tract_Median_Family_Income"];

        var s = Trim(Text(raw));
        if (IsEmpty(s) || s == "") return "N/A";

        s = Replace(s, ",", "");
        s = Replace(s, "$", "");
        s = Replace(s, FromCharCode(160), "");

        var v = Number(s);
        if (IsNan(v)) return "N/A";

        return "$" + Text(v, "#,###");
      `,
    },
    {
      name: "expr2",
      title: "State Median Family Income",
      expression: `
        var raw = $feature["State_Benchmark_Median_Family_Income"];

        var s = Trim(Text(raw));
        if (IsEmpty(s) || s == "") return "N/A";

        s = Replace(s, ",", "");
        s = Replace(s, "$", "");
        s = Replace(s, FromCharCode(160), "");

        var v = Number(s);
        if (IsNan(v)) return "N/A";

        return "$" + Text(v, "#,###");
      `,
    },
    {
      name: "expr3",
      title: "MSA Median Family Income",
      expression: `
        var raw = $feature["MSA_Benchmark_Median_Family_Income"];

        var s = Trim(Text(raw));
        if (IsEmpty(s) || s == "") return "N/A";

        s = Replace(s, ",", "");
        s = Replace(s, "$", "");
        s = Replace(s, FromCharCode(160), "");

        var n = Number(s);
        if (IsNan(n) || n == 0) return "N/A";

        return "$" + Text(n, "#,###");
      `,
    },
    {
      name: "expr4",
      title: "Tract % of State Benchmark",
      expression: `
        var v = $feature["Census_Tract_Percent_of_State_Benchmarked_Median_Family_Income"];
        if (IsEmpty(v) || Trim(Text(v)) == "") return "N/A";
        return Text(v) + "%";
      `,
    },
    {
      name: "expr5",
      title: "Tract % of MSA Benchmark",
      expression: `
        var v = $feature["Census_Tract_Percent_of_MSA_Benchmarked_Median_Family_Income"];
        if (IsEmpty(v) || Trim(Text(v)) == "") return "N/A";
        return Text(v) + "%";
      `,
    },
  ],
  content: `
    <div style="font-family:Arial, sans-serif;font-size:13px;">
      <div style="background-color:#2b4a6f;color:#ffffff;font-size:15px;margin:-4px -4px 8px;padding:6px 10px;">
        <strong>Census Tract Profile</strong>
      </div>

      <div style="margin:4px 0 10px;">
        <div style="color:#333;">
          <strong>Census Tract: </strong><span><strong>{GEOID11}</strong></span><strong>&nbsp;</strong>
        </div>

        <div style="color:#555;margin-top:2px;">
          County: <strong>{County_Name}</strong><br>
          Metro / Non-Metro: <span><strong>{Metro_Nonmetro_Designation}</strong></span><strong>&nbsp;</strong><br>
          RUCA Type: <strong>{RUCA_Type}</strong> Value: <span><strong>{PrimaryRUCA}&nbsp;</strong></span>
        </div>

        <div style="color:#555;margin-top:2px;">
          Total Population: <strong>{POP_TOTAL}</strong><br>
          <strong>Low Income:</strong> <span><strong>{Does_Census_Tract_Qualify_for_IGI_based_on_Poverty_or_Income_Criteria}</strong></span>&nbsp;
        </div>

        <div style="color:#555;margin-top:2px;">
          <strong>Low Access: </strong><span><strong>{expression/expr0}</strong></span><strong>&nbsp;</strong>
        </div>
      </div>

      <div style="border-bottom:1px solid #cccccc;color:#a32b2b;margin:6px 0 4px;padding-bottom:2px;">
        <strong>Low Access to Healthy Food</strong>
      </div>

      <table style="border-collapse:collapse;margin-bottom:8px;">
        <tbody>
          <tr style="background-color:#f5f5f5;">
            <td style="color:#333;padding:4px 6px;width:55%;">
              Low-Access Population
            </td>
            <td style="padding:4px 6px;text-align:right;">
              <strong>{LOWACC_POP_FIX}</strong>
            </td>
          </tr>
          <tr>
            <td style="color:#333;padding:4px 6px;">
              Low-Access Share of Tract Population
            </td>
            <td style="padding:4px 6px;text-align:right;">
              <strong>{PCT_LOWACC}%</strong>
            </td>
          </tr>
        </tbody>
      </table>

      <div style="border-bottom:1px solid #cccccc;color:#a32b2b;margin:6px 0 4px;padding-bottom:2px;">
        <strong>Poverty &amp; Income Indicators</strong>
      </div>

      <table style="border-collapse:collapse;margin-bottom:4px;">
        <tbody>
          <tr style="background-color:#f5f5f5;">
            <td style="color:#333;padding:4px 6px;width:55%;">
              Census Tract Poverty Rate
            </td>
            <td style="padding:4px 6px;text-align:right;">
              <span><strong>{Census_Tract_Poverty_Rate}</strong></span><strong> %</strong>
            </td>
          </tr>
          <tr>
            <td style="color:#333;padding:4px 6px;">
              Median Family Income (Tract)
            </td>
            <td style="padding:4px 6px;text-align:right;">
              <span><strong>{expression/expr1}</strong></span>
            </td>
          </tr>
          <tr style="background-color:#f5f5f5;">
            <td style="color:#333;padding:4px 6px;">
              State Median Family Income
            </td>
            <td style="padding:4px 6px;text-align:right;">
              <span><strong>{expression/expr2}</strong></span><strong>&nbsp;</strong>
            </td>
          </tr>
          <tr>
            <td style="color:#333;padding:4px 6px;">
              Tract % of State Benchmark
            </td>
            <td style="padding:4px 6px;text-align:right;">
              <span><strong>{expression/expr4}</strong></span><strong>&nbsp;</strong>
            </td>
          </tr>
          <tr style="background-color:#f5f5f5;">
            <td style="color:#333;padding:4px 6px;">
              MSA Median Family Income
            </td>
            <td style="padding:4px 6px;text-align:right;">
              <span><strong>{expression/expr3}</strong></span><strong>&nbsp;</strong>
            </td>
          </tr>
          <tr>
            <td style="color:#333;padding:4px 6px;">
              Tract % of MSA Benchmark
            </td>
            <td style="padding:4px 6px;text-align:right;">
              <span><strong>{expression/expr5}</strong></span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
};

async function main() {
  setStatus("Loading config…");
  const cfg = await loadConfig();

  const { center, zoom, scale } = applyUrlViewState(cfg);

  const layerUrl1 =
    "https://services2.arcgis.com/QUAsjBqieHEMNnZW/arcgis/rest/services/IL_CT_UR_Joined_RUCA_022626/FeatureServer/3";

  const layerUrl2 =
    "https://services2.arcgis.com/QUAsjBqieHEMNnZW/arcgis/rest/services/IL_CT_UR_Joined_RUCA_ALL_022626/FeatureServer/0";

  const layerUrl3 =
    "https://services2.arcgis.com/QUAsjBqieHEMNnZW/arcgis/rest/services/IL_Counties/FeatureServer/0";

  const layerUrl4 =
    "https://services2.arcgis.com/QUAsjBqieHEMNnZW/arcgis/rest/services/Grocery_Locations/FeatureServer/0";

  setStatus("Loading layers…");

  const layer1 = new FeatureLayer({
    url: layerUrl1,
    outFields: ["*"],
    popupEnabled: true,
    popupTemplate: sharedPopupTemplate,
  });

  const layer2 = new FeatureLayer({
    url: layerUrl2,
    outFields: ["*"],
    popupEnabled: true,
    popupTemplate: sharedPopupTemplate,
  });

  const layer3 = new FeatureLayer({
    url: layerUrl3,
    outFields: ["*"],
    popupEnabled: true,
  });

  const layer4 = new FeatureLayer({
    url: layerUrl4,
    outFields: ["*"],
    popupEnabled: true,
  });

  const map = new Map({
    basemap: "streets-vector",
    layers: [layer1, layer2, layer3, layer4],
  });

  const viewOptions = {
    container: "viewDiv",
    map,
    center,
  };

  if (zoom !== null) viewOptions.zoom = zoom;
  else if (scale !== null) viewOptions.scale = scale;

  setStatus("Creating view…");
  const view = new MapView(viewOptions);

  const ACTION_LAYER_URLS = new Set([
    layerUrl1,
    layerUrl2,
    layerUrl3,
    layerUrl4,
  ]);

  function isActionLayer(layer) {
    const url = layer?.url?.replace(/\/+$/, "");
    return !!url && ACTION_LAYER_URLS.has(url);
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
  console.log("View ready");

  try {
    await Promise.all([
      layer1.load(),
      layer2.load(),
      layer3.load(),
      layer4.load(),
    ]);

    console.log("All layers loaded");

    if (layer1.fullExtent) {
      await view.goTo(layer1.fullExtent.expand(1.2));
      setStatus("Ready ✅ (zoomed to layer)");
    } else if (layer1.queryExtent) {
      const { extent } = await layer1.queryExtent();
      if (extent) {
        await view.goTo(extent.expand(1.2));
        setStatus("Ready ✅ (queried extent)");
      } else {
        setStatus("Ready ✅ (no extent returned)");
      }
    } else {
      setStatus("Ready ✅ (layers loaded)");
    }
  } catch (e) {
    console.error("Layer load FAILED:", e);
    setStatus("One or more layers failed to load (see Console)");
  }

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
      setTimeout(() => setStatus("Ready ✅"), 1200);
    } catch {
      window.prompt("Copy this link:", url.toString());
    }
  });

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

  view.watch("updating", (isUpdating) => {
    const current = statusEl.textContent || "";
    const isIdentifying = current.startsWith("Identifying");
    if (isIdentifying) return;

    if (isUpdating) setStatus("Updating…");
  });

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
