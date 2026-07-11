/**
 * Fictional-data generator for the Digital Twin demo.
 *
 * Renders at the REAL terminal location (public geography — visible on any map)
 * but every attribute is fabricated: no real container codes, carriers, visits,
 * vessel identities or move counts are used. Clicking a box shows invented data.
 *
 * Mirrors the real twin's data shapes so the same ScenegraphLayer render path
 * and the same interactions (vessel -> its containers + its cranes, yard stats)
 * work unchanged.
 *
 * Output: public/data/digital-twin.json     Run: node scripts/gen_demo_data/digital-twin.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---- deterministic PRNG ----------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260707);
const rnd = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const r2 = (n) => Math.round(n * 100) / 100;

// ---- geo transform (real port geography, deliberately not the real terminal)-
// Placed on a Japanese container terminal so the basemap shows authentic port
// land/water, fully removed from the real site. Origin = a yard corner; grid
// Y+ runs inland, Y- toward the water where vessels berth. Tune ROTATION so the
// quay aligns with the real shoreline.
const ORIGIN = { lat: 35.0674, lon: 128.8100 }; // Kobe Port Island south quay
const GRID_ROTATION = 169; // yard runs north (inland); vessels berth south (bay)
const CAMERA_BEARING = 35;
const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
function destination(lat, lon, bearingDeg, dist) {
  const br = toRad(bearingDeg), dr = dist / R, la1 = toRad(lat), lo1 = toRad(lon);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(dr) + Math.cos(la1) * Math.sin(dr) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(
    Math.sin(br) * Math.sin(dr) * Math.cos(la1),
    Math.cos(dr) - Math.sin(la1) * Math.sin(la2)
  );
  return [toDeg(lo2), toDeg(la2)];
}
function gridToLonLat(x, y) {
  const dist = Math.hypot(x, y);
  const localAngle = toDeg(Math.atan2(x, y));
  return destination(ORIGIN.lat, ORIGIN.lon, GRID_ROTATION + localAngle, dist);
}

// ---- palettes --------------------------------------------------------------
const CARRIER_TYPE_COLORS = { VS: [55, 126, 184], TK: [77, 175, 74], TR: [255, 127, 0], BG: [152, 78, 163] };
const SIZE_COLORS = { 10: [64, 224, 208], 20: [77, 175, 74], 30: [55, 126, 184], 40: [255, 127, 0], 45: [152, 78, 163] };
const CARRIER_WEIGHTS = [["VS", 0.55], ["TK", 0.28], ["TR", 0.1], ["BG", 0.07]];
function weightedCarrier() {
  const x = rand();
  let acc = 0;
  for (const [k, w] of CARRIER_WEIGHTS) { acc += w; if (x <= acc) return k; }
  return "VS";
}
const OTHER_VESSEL_CODES = ["AURELIA", "HELIOS", "TRITON", "ORION", "VEGA", "ATLAS"];
const carrierCodeFor = (type) => {
  if (type === "VS") return pick([...OTHER_VESSEL_CODES]);
  if (type === "TK") return "TRK-" + Math.floor(rnd(1000, 9999));
  if (type === "TR") return "RL-" + Math.floor(rnd(100, 999));
  return "BRG-" + Math.floor(rnd(10, 99));
};
const HEIGHT_CODES = { 86: 2.59, 96: 2.9 };
const containerModel = (len, code) => `${len}ft_${code}_container.glb`;
const REEFER = /^R(0[1-9]|[12][0-9])$/;

// ---- berthed vessels (fictional identities) --------------------------------
const vesselsRaw = [
  { name: "NORDIC HORIZON", code: "NORDIC", visitCode: "250118", gx: 320, len: 366, beam: 51, mmsi: 205519000, imo: 9776171, sog: 0, berthT: 0, moves: { discharge: 1240, load: 980 }, eta: "2026-07-07T04:10", etd: "2026-07-07T22:30" },
  { name: "MERIDIAN STAR", code: "MERIDIAN", visitCode: "250142", gx: 900, len: 330, beam: 48, mmsi: 636020341, imo: 9461447, sog: 0, berthT: 0, moves: { discharge: 890, load: 1120 }, eta: "2026-07-07T02:40", etd: "2026-07-07T19:15" },
  { name: "CALYPSO TRADER", code: "CALYPSO", visitCode: "250187", gx: 1230, len: 294, beam: 45, mmsi: 477123400, imo: 9302877, sog: 8.2, berthT: 0.42, moves: { discharge: 640, load: 700 }, eta: "2026-07-07T09:30", etd: "2026-07-08T03:00" },
];
const vesselVisitCodes = vesselsRaw.map((v) => v.visitCode);

// ---- yard blocks + containers ----------------------------------------------
const BANDS = 3, BLOCKS_PER_BAND = 6;
const BLOCK_W = 150, BLOCK_D = 116, BLOCK_GAP_X = 40, BAND_GAP_Y = 46, APRON = 120;
const CELL_X = 2.95, CELL_Y = 13.0;
const bandStartY = (b) => APRON + b * (BLOCK_D + BAND_GAP_Y);
const blockStartX = (c) => 70 + c * (BLOCK_W + BLOCK_GAP_X);
// Band 0 -> A1.., band 1 -> B1.., band 2 -> C1.. with a small reefer section
// (R01/R02) at the near end — reefers are a dedicated minority of the yard.
const areaName = (band, col) =>
  band === 2 ? (col < 2 ? "R0" + (col + 1) : "C" + (col + 1)) : String.fromCharCode(65 + band) + (col + 1);

const containers = {};
const blocks = [];
let cid = 1, sumLon = 0, sumLat = 0, nPts = 0;
function pushContainer(model, obj) {
  (containers[model] ??= []).push(obj);
  sumLon += obj.coordinates[0]; sumLat += obj.coordinates[1]; nPts++;
}

for (let band = 0; band < BANDS; band++) {
  for (let col = 0; col < BLOCKS_PER_BAND; col++) {
    const x0 = blockStartX(col), y0 = bandStartY(band);
    const area = areaName(band, col);
    blocks.push({ id: area, x0, y0, w: BLOCK_W, d: BLOCK_D });
    const nx = Math.floor(BLOCK_W / CELL_X), ny = Math.floor(BLOCK_D / CELL_Y);
    const fill = 0.72 - band * 0.08;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        if (!chance(fill)) continue;
        const stack = chance(0.08) ? 4 : chance(0.4) ? 3 : chance(0.7) ? 2 : 1;
        const [lon, lat] = gridToLonLat(x0 + ix * CELL_X + CELL_X / 2, y0 + iy * CELL_Y + CELL_Y / 2);
        const len = chance(0.66) ? 40 : chance(0.55) ? 20 : 45;
        const code = chance(0.35) ? 96 : 86;
        const model = containerModel(len, code);
        for (let t = 0; t < stack; t++) {
          const outType = weightedCarrier();
          // Link a share of vessel-bound boxes to a berthed vessel's visit so
          // clicking that vessel lights up its containers.
          let outVisit = null, outCode;
          if (outType === "VS" && chance(0.5)) {
            const v = pick(vesselsRaw);
            outVisit = v.visitCode; outCode = v.code;
          } else if (outType === "VS") {
            outVisit = "24" + Math.floor(rnd(1000, 9999)); outCode = pick(OTHER_VESSEL_CODES);
          } else {
            outCode = carrierCodeFor(outType);
          }
          const inType = weightedCarrier();
          pushContainer(model, {
            coordinates: [r6(lon), r6(lat), r2(t * (HEIGHT_CODES[code] + 0.02))],
            angle: 0,
            containerLength: len,
            containerHeight: code === 96 ? 9.6 : 8.6,
            area,
            containerCode: "CN" + String(cid++).padStart(6, "0"),
            incomingCarrierType: inType,
            incomingCarrierCode: carrierCodeFor(inType),
            outgoingCarrierType: outType,
            outgoingCarrierCode: outCode,
            outgoingVisitCode: outVisit,
          });
        }
      }
    }
  }
}

// ---- vessels ---------------------------------------------------------------
// Vessels berth alongside the quay, which runs along grid-X. In geographic
// terms that bearing is GRID_ROTATION + 90, so the hull stays parallel to the
// quay at any location/rotation.
const QUAY_HEADING = (GRID_ROTATION + 90) % 360;
const vesselAt = (gx, gy) => { const [lon, lat] = gridToLonLat(gx, gy); return [r6(lon), r6(lat), 0]; };
const vessels = vesselsRaw.map((v) => ({
  name: v.name, code: v.code, visitCode: v.visitCode,
  mmsi: v.mmsi, imo: v.imo, sog: v.sog, length: v.len, beam: v.beam, heading: QUAY_HEADING,
  eta: v.eta, etd: v.etd, berthingStatus: "ACT", moves: v.moves, berthT: v.berthT,
  coordinates: vesselAt(v.gx, -v.beam / 2 - 12),
  offshore: vesselAt(v.gx, -260),
}));

// ---- STS cranes (assigned to the vessel they work) -------------------------
const cranes = [];
let craneId = 51;
for (const v of vesselsRaw) {
  const n = v.len > 340 ? 4 : 3;
  for (let i = 0; i < n; i++) {
    const gx = v.gx - v.len / 2 + 40 + i * ((v.len - 80) / (n - 1));
    const [lon, lat] = gridToLonLat(gx, 18);
    cranes.push({
      coordinates: [r6(lon), r6(lat), 0],
      craneId, craneName: "STS-" + craneId, angle: 0,
      positionX: r2(gx), positionY: 18,
      vessel: v.code, visitCode: v.visitCode, arriveT: v.berthT,
    });
    craneId++;
  }
}

// ---- straddle carriers (animated paths) ------------------------------------
// Straddles only ever drive the aisle grid *between* blocks — never across a
// block and never diagonally. The aisles form a clean grid: vertical column
// lanes (continuous front-to-back) at the gaps between/around block columns, and
// horizontal lanes (continuous across the yard) at the gaps between/around bands
// plus the apron in front. Every waypoint is snapped to a lane intersection, and
// consecutive waypoints are joined by an L-shaped (Manhattan) route through a
// corner intersection, so every rendered segment is axis-aligned and stays in a
// lane.
const laneX = (c) => blockStartX(c) - BLOCK_GAP_X / 2; // c = 0..BLOCKS_PER_BAND
const laneY = (b) => bandStartY(b) - BAND_GAP_Y / 2;   // b = 0..BANDS (0 = apron front lane)
const nearestLaneX = (gx) => {
  let best = 0, bestD = Infinity;
  for (let c = 0; c <= BLOCKS_PER_BAND; c++) {
    const d = Math.abs(laneX(c) - gx);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
};

const straddles = [];
for (let i = 0; i < 16; i++) {
  const nodeCount = Math.floor(rnd(4, 7));
  // Task nodes on lane intersections: alternate a quay-front visit (apron lane,
  // near a vessel's column) with a yard visit (an aisle beside a block).
  const nodes = [];
  for (let w = 0; w < nodeCount; w++) {
    if (w % 2 === 0) {
      const v = pick(vesselsRaw);
      nodes.push([laneX(nearestLaneX(v.gx + rnd(-80, 80))), laneY(0)]);
    } else {
      const col = Math.floor(rnd(0, BLOCKS_PER_BAND)); // block column 0..5
      const band = Math.floor(rnd(0, BANDS));          // band 0..2
      nodes.push([laneX(chance(0.5) ? col : col + 1), laneY(chance(0.5) ? band : band + 1)]);
    }
  }
  // Expand into an axis-aligned point loop. For each node we emit the node then
  // a corner [next.x, cur.y]: node->corner is horizontal (along cur's lane),
  // corner->next is vertical (along next's lane). The closing wrap shares an x,
  // so it stays vertical too — the whole loop is Manhattan, never diagonal.
  const path = [];
  for (let w = 0; w < nodes.length; w++) {
    const cur = nodes[w], nxt = nodes[(w + 1) % nodes.length];
    const [lonN, latN] = gridToLonLat(cur[0], cur[1]);
    path.push([r6(lonN), r6(latN)]);
    const [lonC, latC] = gridToLonLat(nxt[0], cur[1]);
    path.push([r6(lonC), r6(latC)]);
  }
  straddles.push({ straddleId: 20000 + i, speed: r2(rnd(0.7, 1.35)), phase: r2(rand()), path });
}

// ---- camera ----------------------------------------------------------------
const camera = {
  longitude: r6(sumLon / nPts), latitude: r6(sumLat / nPts),
  zoom: 14.2, pitch: 50, bearing: CAMERA_BEARING,
};

// ---- assemble + write ------------------------------------------------------
const containerCount = Object.values(containers).reduce((a, l) => a + l.length, 0);
const data = {
  meta: {
    location: "Container terminal, Osaka Bay (real port geography · fabricated data)",
    origin: ORIGIN, rotation: GRID_ROTATION, camera,
    carrierColors: CARRIER_TYPE_COLORS, sizeColors: SIZE_COLORS,
    reeferPattern: REEFER.source,
    timeline: { steps: 120, startLabel: "06:00", endLabel: "14:00" },
    vesselVisitCodes,
    counts: { containers: containerCount, cranes: cranes.length, vessels: vessels.length, straddles: straddles.length },
  },
  blocks, containers, cranes, vessels, straddles,
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../../public/data/digital-twin.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(data));
console.log(
  `✓ digital-twin.json (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)\n` +
  `  containers: ${containerCount} · cranes: ${cranes.length} · vessels: ${vessels.length} · straddles: ${straddles.length}\n` +
  `  location: real MPET origin · camera ${camera.longitude}, ${camera.latitude}`
);
