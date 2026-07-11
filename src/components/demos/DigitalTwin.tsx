import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { Map as MapGL } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import { registerLoaders } from "@loaders.gl/core";
import { GLTFLoader } from "@loaders.gl/gltf";

registerLoaders([GLTFLoader]);

// Model yaw is derived from the grid rotation so the models stay aligned to the
// quay at ANY location: forward-along-grid-Y ⟺ yaw = 90 − GRID_ROTATION.
// (This reproduces the original 147.75 at the old rotation of 302.244.)
const gridYawFor = (rotation: number) => 90 - rotation;
const MODEL_ROLL = 90;
const CRANE_SIZE_SCALE = 0.0125;
const VESSEL_MODEL_LENGTH_M = 10760.6;
const VESSEL_HEADING_OFFSET = 180;
const BASEMAP = "https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json";

const COLOR_PALETTE = [
  [228, 26, 28], [55, 126, 184], [77, 175, 74], [152, 78, 163],
  [255, 127, 0], [166, 86, 40], [247, 129, 191], [153, 153, 153],
];

type RGB = number[];
type Vec2 = [number, number];
type ColorMode = "default" | "vessel" | "outgoing_type" | "size" | "area";

// ---- colour helpers (mirrors the real twin) --------------------------------
function hashColorIndex(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) & 0xfffffff;
  return hash % COLOR_PALETTE.length;
}
function computeColor(d: any, mode: ColorMode, meta: any, vessel: any): RGB {
  switch (mode) {
    case "vessel":
      if (!vessel || vessel.visitCode == null) return [255, 255, 255, 255];
      return d.outgoingVisitCode === vessel.visitCode ? [55, 200, 100, 255] : [150, 150, 150, 20];
    case "outgoing_type":
      return [...(meta.carrierColors[d.outgoingCarrierType] || [150, 150, 150]), 255];
    case "size":
      return [...(meta.sizeColors[d.containerLength] || [150, 150, 150]), 255];
    case "area":
      return [...COLOR_PALETTE[hashColorIndex(d.area || "")], 255];
    default:
      return [255, 255, 255, 255];
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function posAlongPath(path: Vec2[], u: number): { pos: Vec2; bearing: number } {
  const n = path.length;
  const f = (((u % 1) + 1) % 1) * n;
  const i = Math.floor(f) % n;
  const frac = f - Math.floor(f);
  const a = path[i], b = path[(i + 1) % n];
  const pos: Vec2 = [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
  const latMid = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const bearing = (Math.atan2((b[0] - a[0]) * Math.cos(latMid), b[1] - a[1]) * 180) / Math.PI;
  return { pos, bearing };
}
function timeLabel(t: number, start: string, end: string): string {
  const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const mins = lerp(toMin(start), toMin(end), t);
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(Math.floor(mins % 60)).padStart(2, "0")}`;
}
const groupCount = (arr: any[], key: (d: any) => string) => {
  const m = new Map<string, number>();
  for (const d of arr) { const k = key(d); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].map(([k, count]) => ({ k, count })).sort((a, b) => b.count - a.count);
};

// ---- component -------------------------------------------------------------
export default function DigitalTwin() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [colorMode, setColorMode] = useState<ColorMode>("default");
  const [selectedVessel, setSelectedVessel] = useState<any>(null);
  const [inspect, setInspect] = useState<any>(null);
  const [tab, setTab] = useState<"overview" | "vessel" | "display">("overview");
  const [show, setShow] = useState({ containers: true, cranes: true, straddles: true, vessels: true });
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const base = import.meta.env.BASE_URL;

  useEffect(() => {
    fetch(base + "data/digital-twin.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!playing) return;
    const tick = (now: number) => {
      if (!lastRef.current) lastRef.current = now;
      setT((p) => (p + (now - lastRef.current) / 1000 / 40) % 1);
      lastRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); lastRef.current = 0; };
  }, [playing]);

  const allContainers = useMemo(
    () => (data ? Object.values(data.containers).flat() as any[] : []),
    [data]
  );
  const reefer = useMemo(
    () => (data ? new RegExp(data.meta.reeferPattern) : /^R/),
    [data]
  );

  // Yard stats — scoped to the selected vessel's containers when one is picked.
  const stats = useMemo(() => {
    if (!data) return null;
    const scope = selectedVessel
      ? allContainers.filter((c) => c.outgoingVisitCode === selectedVessel.visitCode)
      : allContainers;
    return {
      total: scope.length,
      reefer: scope.filter((c) => reefer.test(c.area || "")).length,
      byType: groupCount(scope, (c) => c.outgoingCarrierType || "Unknown"),
      byArea: groupCount(scope, (c) => c.area || "Unknown").slice(0, 15),
    };
  }, [data, allContainers, selectedVessel, reefer]);

  const manifest = useMemo(() => {
    if (!selectedVessel) return null;
    const scope = allContainers.filter((c) => c.outgoingVisitCode === selectedVessel.visitCode);
    return {
      total: scope.length,
      bySize: groupCount(scope, (c) => `${c.containerLength}`).sort((a, b) => +a.k - +b.k),
      byIncoming: groupCount(scope, (c) => c.incomingCarrierType || "Unknown"),
    };
  }, [selectedVessel, allContainers]);

  function selectVessel(v: any) {
    setSelectedVessel(v);
    setColorMode("vessel");
    setInspect(null);
    setTab("vessel");
  }
  function deselectVessel() {
    setSelectedVessel(null);
    setColorMode((m) => (m === "vessel" ? "default" : m));
    setTab("overview");
  }

  const containerLayers = useMemo(() => {
    if (!data || !show.containers) return [];
    const gridYaw = gridYawFor(data.meta.rotation);
    return Object.keys(data.containers).map(
      (model) =>
        new ScenegraphLayer({
          id: "containers_" + model,
          data: data.containers[model],
          scenegraph: base + "models/" + model,
          loaders: [GLTFLoader],
          _lighting: "pbr",
          sizeScale: 1,
          pickable: true,
          autoHighlight: true,
          highlightColor: [247, 165, 43, 200],
          getPosition: (d: any) => d.coordinates,
          getOrientation: (d: any) => [0, gridYaw - d.angle, MODEL_ROLL],
          getColor: (d: any) => computeColor(d, colorMode, data.meta, selectedVessel),
          updateTriggers: { getColor: [colorMode, selectedVessel?.visitCode] },
          onClick: (info: any) => info.object && setInspect({ type: "container", o: info.object }),
        })
    );
  }, [data, colorMode, selectedVessel, show.containers]);

  const equipmentLayers = useMemo(() => {
    if (!data) return [];
    const out: any[] = [];
    const selVisit = selectedVessel?.visitCode ?? null;
    const gridYaw = gridYawFor(data.meta.rotation);

    if (show.cranes) {
      const active = data.cranes.filter((c: any) => t >= (c.arriveT ?? 0) - 0.02);
      out.push(new ScenegraphLayer({
        id: "cranes", data: active, scenegraph: base + "models/sts_crane.glb",
        loaders: [GLTFLoader], _lighting: "pbr", sizeScale: CRANE_SIZE_SCALE, pickable: true,
        getPosition: (d: any) => d.coordinates,
        // Cranes face across the quay — a 90° clockwise turn from the yard grid.
        getOrientation: (d: any) => [0, gridYaw - d.angle - 90, MODEL_ROLL],
        getColor: (d: any) =>
          selVisit == null ? [0, 110, 45, 255]
            : d.visitCode === selVisit ? [0, 170, 70, 255] : [150, 150, 150, 40],
        updateTriggers: { getPosition: [t], getColor: [selVisit] },
        onClick: (info: any) => info.object && setInspect({ type: "crane", o: info.object }),
      }));
    }

    if (show.vessels) {
      const vData = data.vessels.map((v: any) => {
        let coords = v.coordinates;
        if (v.berthT > 0) {
          if (t < v.berthT - 0.12) return null;
          const p = clamp01((t - (v.berthT - 0.12)) / 0.12);
          coords = [lerp(v.offshore[0], v.coordinates[0], p), lerp(v.offshore[1], v.coordinates[1], p), 0];
        }
        return { ...v, _c: coords };
      }).filter(Boolean);
      out.push(new ScenegraphLayer({
        id: "vessels", data: vData, scenegraph: base + "models/vessel.glb",
        loaders: [GLTFLoader], _lighting: "pbr", sizeScale: 1, pickable: true,
        getPosition: (d: any) => d._c,
        getOrientation: (d: any) => [0, VESSEL_HEADING_OFFSET - d.heading, MODEL_ROLL],
        getScale: (d: any) => { const s = d.length / VESSEL_MODEL_LENGTH_M; return [s, s, s]; },
        getColor: (d: any) =>
          selVisit == null || d.visitCode === selVisit ? [255, 255, 255, 255] : [150, 150, 150, 40],
        updateTriggers: { getPosition: [t], getColor: [selVisit] },
        onClick: (info: any) => info.object && selectVessel(info.object),
      }));
    }

    if (show.straddles) {
      const scData = data.straddles.map((s: any) => {
        const { pos, bearing } = posAlongPath(s.path, t * s.speed + s.phase);
        return { straddleId: s.straddleId, position: [pos[0], pos[1], 0], bearing, speed: s.speed };
      });
      out.push(new ScenegraphLayer({
        id: "straddles", data: scData, scenegraph: base + "models/straddle_carrier.glb",
        loaders: [GLTFLoader], _lighting: "pbr", sizeScale: 1, pickable: true,
        getPosition: (d: any) => d.position,
        getOrientation: (d: any) => [0, 90 - d.bearing, MODEL_ROLL],
        getColor: [255, 210, 0, 255],
        updateTriggers: { getPosition: [t], getOrientation: [t] },
        onClick: (info: any) => info.object && setInspect({ type: "straddle", o: info.object }),
      }));
    }
    return out;
  }, [data, t, show.cranes, show.vessels, show.straddles, selectedVessel]);

  if (error) return <Frame><p className="text-sm text-red-300">Couldn't load the terminal data ({error}).</p></Frame>;
  if (!data || !stats)
    return (
      <Frame>
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[var(--color-data)] border-t-transparent" />
          <p className="font-mono text-sm text-[var(--color-muted)]">Loading terminal…</p>
        </div>
      </Frame>
    );

  const cam = data.meta.camera;

  return (
    <div className="relative h-[78vh] min-h-[520px] w-full overflow-hidden rounded-xl border border-[var(--color-border-solid)] bg-[#aeb7bd]">
      <DeckGL
        initialViewState={{ longitude: cam.longitude, latitude: cam.latitude, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing }}
        controller={true}
        layers={[...containerLayers, ...equipmentLayers]}
        getCursor={({ isDragging }: any) => (isDragging ? "grabbing" : "grab")}
      >
        <MapGL reuseMaps mapStyle={BASEMAP} />
      </DeckGL>

      {/* ---- Left sidebar ---- */}
      <div className="absolute left-4 top-4 flex max-h-[calc(100%-2rem)] w-[290px] flex-col overflow-hidden rounded-xl border border-[var(--color-border-solid)] bg-[#0e1420f2] text-sm backdrop-blur">
        <div className="flex items-center justify-between border-b border-[var(--color-border-solid)] px-4 py-2.5">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[var(--color-data)]">
            {timeLabel(t, data.meta.timeline.startLabel, data.meta.timeline.endLabel)} · live replay
          </span>
        </div>
        <div className="flex border-b border-[var(--color-border-solid)] text-xs">
          {(["overview", "vessel", "display"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-1 py-2 capitalize transition-colors ${
                tab === k ? "border-b-2 border-[var(--color-accent)] text-white" : "text-[var(--color-muted)] hover:text-white"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto px-4 py-3">
          {tab === "overview" && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
                  {selectedVessel ? `Vessel: ${selectedVessel.name}` : "Whole yard"}
                </span>
                {selectedVessel && (
                  <button onClick={deselectVessel} className="rounded border border-[var(--color-border-solid)] px-1.5 text-[var(--color-muted)] hover:text-white">✕</button>
                )}
              </div>
              <div className="mb-4 grid grid-cols-2 gap-2">
                <Kpi label="Total" value={stats.total.toLocaleString()} />
                <Kpi label="Reefers" value={stats.reefer.toLocaleString()} />
              </div>
              <SectionLabel>Outgoing by carrier type</SectionLabel>
              <div className="mb-4">
                {stats.byType.map((r) => (
                  <Bar key={r.k} label={r.k} count={r.count} max={stats.total} color="var(--color-data)" />
                ))}
              </div>
              <SectionLabel>Area occupancy (top 15)</SectionLabel>
              {stats.byArea.map((r) => (
                <Bar key={r.k} label={r.k} count={r.count} max={stats.byArea[0]?.count || 1} color="var(--color-accent)" />
              ))}
            </>
          )}

          {tab === "vessel" && (
            <>
              {!selectedVessel && <p className="text-[var(--color-muted)]">Click a vessel on the map to highlight its containers and the cranes working it.</p>}
              {selectedVessel && (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold text-white">{selectedVessel.name}</span>
                    <button onClick={deselectVessel} className="rounded border border-[var(--color-border-solid)] px-1.5 text-[var(--color-muted)] hover:text-white">✕</button>
                  </div>
                  <DetailTable rows={[
                    ["MMSI", selectedVessel.mmsi], ["IMO", selectedVessel.imo],
                    ["Length", `${selectedVessel.length} m`], ["Beam", `${selectedVessel.beam} m`],
                    ["Speed", `${selectedVessel.sog} kn`],
                  ]} />
                  <SectionLabel className="mt-3">Berth plan</SectionLabel>
                  <DetailTable rows={[
                    ["Visit", selectedVessel.visitCode], ["ETA", selectedVessel.eta?.replace("T", " ")],
                    ["ETD", selectedVessel.etd?.replace("T", " ")],
                    ["Discharge", selectedVessel.moves.discharge], ["Load", selectedVessel.moves.load],
                  ]} />
                  {manifest && (
                    <>
                      <SectionLabel className="mt-3">Manifest · {manifest.total} containers</SectionLabel>
                      <DetailTable rows={manifest.bySize.map((r) => [`${r.k} ft`, r.count])} />
                    </>
                  )}
                </>
              )}
            </>
          )}

          {tab === "display" && (
            <>
              <SectionLabel>Colour containers by</SectionLabel>
              <select
                value={colorMode}
                onChange={(e) => setColorMode(e.target.value as ColorMode)}
                className="mb-3 w-full rounded border border-[var(--color-border-solid)] bg-[#0a0d13] px-2 py-1 text-[var(--color-ink)]"
              >
                <option value="default">Default</option>
                <option value="vessel">Selected vessel</option>
                <option value="outgoing_type">Outgoing carrier type</option>
                <option value="size">Container size</option>
                <option value="area">Yard area</option>
              </select>
              <Legend colorMode={colorMode} meta={data.meta} />
              <SectionLabel className="mt-4">Layers</SectionLabel>
              {(["containers", "cranes", "straddles", "vessels"] as const).map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 py-0.5 capitalize text-[var(--color-muted)] hover:text-white">
                  <input type="checkbox" checked={show[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} className="accent-[var(--color-accent)]" />
                  {k}
                </label>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ---- Right inspect panel ---- */}
      {inspect && <InspectPanel inspect={inspect} onClose={() => setInspect(null)} />}

      {/* ---- Timeline ---- */}
      <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-lg border border-[var(--color-border-solid)] bg-[#0e1420ee] px-3 py-2.5 backdrop-blur">
        <button onClick={() => setPlaying((p) => !p)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[var(--color-accent)] text-[#1a1206]" aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-[var(--color-muted)]">{data.meta.timeline.startLabel}</span>
        <input type="range" min={0} max={1000} value={Math.round(t * 1000)}
          onChange={(e) => { setPlaying(false); setT(Number(e.target.value) / 1000); }}
          className="h-1 flex-1 cursor-pointer accent-[var(--color-accent)]" />
        <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--color-muted)]">{data.meta.timeline.endLabel}</span>
      </div>

      <p className="pointer-events-none absolute bottom-16 right-4 rounded bg-[#0e142099] px-2 py-1 font-mono text-[0.65rem] text-white/70">
        real geography · fabricated data
      </p>
    </div>
  );
}

// ---- presentational --------------------------------------------------------
function Frame({ children }: { children: React.ReactNode }) {
  return <div className="grid h-[78vh] min-h-[520px] w-full place-items-center rounded-xl border border-[var(--color-border-solid)] bg-[#0a0d13]">{children}</div>;
}
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-solid)] bg-[#0a0d13] p-2.5 text-center">
      <div className="text-2xl font-bold tabular-nums text-white">{value}</div>
      <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[var(--color-faint)]">{label}</div>
    </div>
  );
}
function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-1 text-[0.6rem] font-semibold uppercase tracking-wider text-[var(--color-faint)] ${className}`}>{children}</div>;
}
function Bar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  return (
    <div className="mb-1.5">
      <div className="flex justify-between font-mono text-[0.7rem] text-[var(--color-muted)]"><span>{label}</span><span>{count}</span></div>
      <div className="h-1 rounded bg-[#0a0d13]"><div className="h-1 rounded" style={{ width: `${Math.round((count / (max || 1)) * 100)}%`, background: color }} /></div>
    </div>
  );
}
function DetailTable({ rows }: { rows: [string, any][] }) {
  return (
    <table className="w-full text-[0.8rem]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="py-0.5 pr-2 text-[var(--color-faint)] whitespace-nowrap">{k}</td>
            <td className="py-0.5 text-right font-medium text-[var(--color-ink)]">{v ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function InspectPanel({ inspect, onClose }: { inspect: any; onClose: () => void }) {
  const { type, o } = inspect;
  const title = type === "container" ? "Container" : type === "crane" ? "Crane" : "Straddle carrier";
  const rows: [string, any][] =
    type === "container"
      ? [["Code", o.containerCode], ["Size", `${o.containerLength} ft`], ["Area", o.area],
         ["Incoming", `${o.incomingCarrierType} · ${o.incomingCarrierCode}`],
         ["Outgoing", `${o.outgoingCarrierType} · ${o.outgoingCarrierCode}`], ["Visit", o.outgoingVisitCode ?? "—"]]
      : type === "crane"
      ? [["Name", o.craneName], ["X", o.positionX], ["Y", o.positionY], ["Working", o.vessel]]
      : [["ID", `SC-${o.straddleId}`], ["Speed", `${o.speed?.toFixed?.(1) ?? o.speed}`]];
  return (
    <div className="absolute right-4 top-4 w-60 rounded-xl border border-[var(--color-border-solid)] bg-[#0e1420f2] p-4 text-sm backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-white">{title}</span>
        <button onClick={onClose} className="rounded border border-[var(--color-border-solid)] px-1.5 text-[var(--color-muted)] hover:text-white">✕</button>
      </div>
      <DetailTable rows={rows} />
    </div>
  );
}
function Legend({ colorMode, meta }: { colorMode: ColorMode; meta: any }) {
  if (colorMode === "default") return <p className="text-[var(--color-faint)]">Models in their own colours.</p>;
  if (colorMode === "area") return <p className="text-[var(--color-faint)]">Each yard area a unique colour.</p>;
  if (colorMode === "vessel")
    return (
      <div className="space-y-1">
        <LegendRow color="rgb(55,200,100)" label="Selected vessel's boxes" />
        <LegendRow color="rgb(150,150,150)" label="Other" />
      </div>
    );
  const entries = colorMode === "outgoing_type" ? Object.entries(meta.carrierColors) : Object.entries(meta.sizeColors);
  const labels: Record<string, string> =
    colorMode === "outgoing_type"
      ? { VS: "Vessel", TK: "Truck", TR: "Train", BG: "Barge" }
      : { "10": "10 ft", "20": "20 ft", "30": "30 ft", "40": "40 ft", "45": "45 ft" };
  return <div className="space-y-1">{entries.map(([k, rgb]) => <LegendRow key={k} color={`rgb(${(rgb as RGB).join(",")})`} label={labels[k] ?? k} />)}</div>;
}
function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[var(--color-muted)]">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}
    </div>
  );
}
