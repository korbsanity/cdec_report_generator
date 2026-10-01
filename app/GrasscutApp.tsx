"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Brush,
  Download,
  Eraser,
  Flag,
  Hand,
  History,
  Layers3,
  LoaderCircle,
  Pentagon,
  Printer,
  Redo2,
  RectangleHorizontal,
  Satellite,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import ReportEditor from "@/components/ReportEditor";
import PrintableReport from "@/components/PrintableReport";
import { defaultReporting, normalizeReporting, targetWindow, displayDate, type Reporting } from "@/lib/reporting";
import { coverageStyle, datedFeatures, renderReportMap, currentImageryUrl } from "@/lib/report-map";
import {createImagerySource} from '@/lib/imagery';
import {attachMapNavigation} from '@/lib/map-navigation';
import { buffer, lineString } from "@turf/turf";
import type { Feature, LineString } from "geojson";
import OlMap from "ol/Map.js";
import View from "ol/View.js";
import GeoJSON from "ol/format/GeoJSON.js";
import Draw, { createBox } from "ol/interaction/Draw.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import { defaults as defaultControls } from "ol/control/defaults.js";
import { getPointResolution } from "ol/proj.js";
import XYZ from "ol/source/XYZ.js";
import VectorSource from "ol/source/Vector.js";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style.js";
import "ol/ol.css";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  calculateMetrics,
  combine,
  hectares,
  overlap,
  prepareSite,
  subtract,
  type AreaFeature,
  type SiteGeometryData,
} from "@/lib/coverage";
import {
  projectDb,
  type CoverageDay,
  type LegacyProject,
  type ReportDetails,
  type SavedProject,
} from "@/lib/db";

type Tool = "pan" | "paint" | "rectangle" | "polygon" | "erase";
type EditMode = "completed" | "target";
interface HistorySnapshot { coverageDays: CoverageDay[]; reporting: Reporting }

interface WaybackRelease {
  id: string;
  label: string;
  releaseDate: string;
  url: string;
}

interface WaybackCatalog {
  releases: WaybackRelease[];
}

const CURRENT_IMAGERY_ID = "current";
const geometryFormat = new GeoJSON();

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

const defaultDetails: ReportDetails = {
  title: "Grass-Cutting Progress Report",
  reportDate: localDate(),
  preparedBy: "",
  team: "ZEPDI",
  remarks: "",
};

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function colorForCompletion(value: number): string {
  if (value >= 99.95) return "rgba(0, 174, 239, 0.27)";
  if (value >= 75) return "rgba(55, 142, 217, 0.22)";
  if (value >= 40) return "rgba(101, 102, 190, 0.19)";
  return "rgba(255, 255, 255, 0.06)";
}

function selectedDays(days: CoverageDay[], start: string, end: string): CoverageDay[] {
  return days
    .filter((day) => day.date >= start && day.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeProject(project: SavedProject | LegacyProject): SavedProject {
  if (project.version !== 1) return { ...project, version: 3, details: { ...defaultDetails, ...project.details, team: project.details.team || "ZEPDI" }, reporting: normalizeReporting(project.reporting, project.details) };
  const date = project.details.reportDate || localDate();
  return {
    id: "current",
    version: 3,
    updatedAt: project.updatedAt,
    brushMeters: project.brushMeters,
    coverageDays: project.coverage
      ? [{ date, geometry: project.coverage, updatedAt: project.updatedAt }]
      : [],
    workDate: date,
    rangeStart: date,
    rangeEnd: date,
    imageryId: CURRENT_IMAGERY_ID,
    details: { ...defaultDetails, ...project.details },
  };
}

export default function GrasscutApp({onBack}:{onBack:()=>void}) {
  const today = useMemo(() => localDate(), []);
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const coverageLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const blockLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const panelLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const exclusionLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const satelliteLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const targetLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const coverageDaysRef = useRef<CoverageDay[]>([]);
  const reportingRef = useRef<Reporting>(defaultReporting(defaultDetails));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<number|undefined>(undefined);

  const [siteData, setSiteData] = useState<SiteGeometryData | null>(null);
  const [wayback, setWayback] = useState<WaybackRelease[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("paint");
  const [editMode, setEditMode] = useState<EditMode>("completed");
  const [brushMeters, setBrushMeters] = useState(20);
  const [coverageDays, setCoverageDays] = useState<CoverageDay[]>([]);
  const [workDate, setWorkDate] = useState(today);
  const [rangeStart, setRangeStart] = useState(today);
  const [rangeEnd, setRangeEnd] = useState(today);
  const [imageryId, setImageryId] = useState(CURRENT_IMAGERY_ID);
  const [undoStack, setUndoStack] = useState<HistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);
  const [details, setDetails] = useState<ReportDetails>(defaultDetails);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState("Loading saved work…");
  const [showPanels, setShowPanels] = useState(true);
  const [showExclusions, setShowExclusions] = useState(true);
  const [showSatellite, setShowSatellite] = useState(true);
  const [mapSnapshot, setMapSnapshot] = useState<string | null>(null);
  const [latestSnapshot, setLatestSnapshot] = useState<string | null>(null);
  const [reportExtent, setReportExtent] = useState<AreaFeature | null>(null);
  const [reporting, setReporting] = useState<Reporting>(() => defaultReporting(defaultDetails));
  const [printing, setPrinting] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [imageryIncomplete, setImageryIncomplete] = useState(false);
  const [imageryNotice,setImageryNotice]=useState('');
  const [returning,setReturning]=useState(false);

  const preparedSiteResult = useMemo(() => {
    if (!siteData) return { site: null, error: null };
    try {
      return { site: prepareSite(siteData), error: null };
    } catch (error) {
      return {
        site: null,
        error: error instanceof Error ? error.message : "Unable to prepare site geometry.",
      };
    }
  }, [siteData]);
  const preparedSite = preparedSiteResult.site;
  const visibleDays = useMemo(
    () => selectedDays(coverageDays, rangeStart, rangeEnd),
    [coverageDays, rangeStart, rangeEnd],
  );
  const selectedCoverage = useMemo(
    () => combine(visibleDays.map((day) => day.geometry)),
    [visibleDays],
  );
  const activeCoverage = useMemo(
    () => coverageDays.find((day) => day.date === workDate)?.geometry ?? null,
    [coverageDays, workDate],
  );
  const metrics = useMemo(() => {
    if (!siteData || !preparedSite) return null;
    return calculateMetrics(siteData, preparedSite, selectedCoverage);
  }, [siteData, preparedSite, selectedCoverage]);
  const selectedImagery = useMemo(
    () => wayback.find((release) => release.id === imageryId),
    [imageryId, wayback],
  );

  const targetPeriod = useMemo(() => targetWindow(reporting.targetPeriod, details.reportDate || today), [reporting.targetPeriod, details.reportDate, today]);
  const activeTarget = reporting.targets[targetPeriod.key]?.geometry ?? null;
  const targetCoverage = useMemo(() => combine(selectedDays(coverageDays, targetPeriod.start, details.reportDate < targetPeriod.end ? details.reportDate : targetPeriod.end).map(day => day.geometry)), [coverageDays, targetPeriod, details.reportDate]);
  const targetAchievementCoverage = useMemo(() => activeTarget ? overlap(targetCoverage, activeTarget) : targetCoverage, [targetCoverage, activeTarget]);
  const targetMetrics = useMemo(() => siteData && preparedSite ? calculateMetrics(siteData, preparedSite, targetAchievementCoverage) : null, [siteData, preparedSite, targetAchievementCoverage]);
  const latestDay = visibleDays.at(-1);
  const latestMetrics = useMemo(() => siteData && preparedSite && latestDay ? calculateMetrics(siteData, preparedSite, latestDay.geometry) : null, [siteData, preparedSite, latestDay]);

  useEffect(() => {
    coverageDaysRef.current = coverageDays;
  }, [coverageDays]);

  useEffect(() => {
    reportingRef.current = reporting;
  }, [reporting]);

  useEffect(() => {
    Promise.all([
      fetch("/data/site-geometry.json").then((response) => {
        if (!response.ok) throw new Error("Unable to load the plant geometry.");
        return response.json() as Promise<SiteGeometryData>;
      }),
      fetch("/data/report-extent.json").then(response => { if (!response.ok) throw new Error("Unable to load report map extent."); return response.json() as Promise<AreaFeature>; }),
      fetch("/data/esri-wayback.json").then((response) => {
        if (!response.ok) throw new Error("Unable to load the Esri imagery catalog.");
        return response.json() as Promise<WaybackCatalog>;
      }),
    ])
      .then(([geometry, extent, catalog]) => {
        setReportExtent(extent);
        setSiteData(geometry);
        setWayback(catalog.releases);
      })
      .catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : "Unable to load app data."),
      );
  }, []);

  useEffect(() => {
    projectDb.projects
      .get("current")
      .then((stored) => {
        if (!stored) {
          setSaveState("Ready — changes save automatically");
          return;
        }
        const saved = normalizeProject(stored);
        setCoverageDays(saved.coverageDays);
        setBrushMeters(saved.brushMeters);
        setWorkDate(saved.workDate);
        setRangeStart(saved.rangeStart);
        setRangeEnd(saved.rangeEnd);
        setImageryId(saved.imageryId);
        setDetails(saved.details);
        const savedReporting = normalizeReporting(saved.reporting, saved.details);
        reportingRef.current = savedReporting;
        setReporting(savedReporting);
        setSaveState(`Restored ${new Date(saved.updatedAt).toLocaleString()}`);
      })
      .catch(() => setSaveState("Autosave unavailable — export a backup"))
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      setSaveState("Saving…");
      const project: SavedProject = {
        id: "current",
        version: 3,
        updatedAt: new Date().toISOString(),
        brushMeters,
        coverageDays,
        workDate,
        rangeStart,
        rangeEnd,
        imageryId,
        details,
        reporting,
      };
      projectDb.projects
        .put(project)
        .then(() => setSaveState("Saved locally"))
        .catch(() => setSaveState("Autosave failed — export a backup"));
    }, 500);
    saveTimerRef.current=timer;
    return () => window.clearTimeout(timer);
  }, [brushMeters, coverageDays, details, reporting, hydrated, imageryId, rangeEnd, rangeStart, workDate]);

  useEffect(() => {
    if (!mapElementRef.current || !siteData || !preparedSite || mapRef.current) return;
    const blockGroups = new Map<string, AreaFeature[]>();
    siteData.blocks.features.forEach((section) => {
      const blockId = String(
        section.properties?.blockId ?? String(section.properties?.name ?? "Block").match(/^B\d+/i)?.[0],
      );
      blockGroups.set(blockId, [...(blockGroups.get(blockId) ?? []), section as AreaFeature]);
    });
    const blockFeatures = Array.from(blockGroups.entries()).flatMap(([blockId, sections]) => {
      const geometry = combine(sections);
      return geometry ? [{ ...geometry, properties: { blockId, name: blockId } }] : [];
    });
    const blockSource = new VectorSource({
      features: geometryFormat.readFeatures({ type: "FeatureCollection", features: blockFeatures }, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      }),
    });
    const panelSource = new VectorSource({
      features: geometryFormat.readFeatures(
        { type: "FeatureCollection", features: preparedSite.panels ? [preparedSite.panels] : [] },
        { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" },
      ),
    });
    const exclusionSource = new VectorSource({
      features: geometryFormat.readFeatures(
        { type: "FeatureCollection", features: preparedSite.exclusions ? [preparedSite.exclusions] : [] },
        { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" },
      ),
    });
    const satelliteLayer = new TileLayer({
      source: createImagerySource(currentImageryUrl),
      preload: 1,
    });
    const panelLayer = new VectorLayer({
      source: panelSource,
      style: new Style({
        fill: new Fill({ color: "rgba(245, 184, 66, 0.11)" }),
        stroke: new Stroke({ color: "rgba(255, 199, 87, 0.92)", width: 1.2 }),
      }),
    });
    const exclusionLayer = new VectorLayer({
      source: exclusionSource,
      style: new Style({
        fill: new Fill({ color: "rgba(222, 70, 77, 0.55)" }),
        stroke: new Stroke({ color: "#ff777d", width: 1.4 }),
      }),
    });
    const coverageLayer = new VectorLayer({
      source: new VectorSource(),
      declutter: 'labels',
      style: coverageStyle,
    });
    const targetLayer = new VectorLayer({
      source: new VectorSource(),
      style: new Style({
        fill: new Fill({ color: "rgba(255, 122, 0, 0.14)" }),
        stroke: new Stroke({ color: "#ff8a18", width: 3, lineDash: [12, 7] }),
        text: new Text({ text: "TARGET", font: "800 14px Arial, sans-serif", overflow: true, fill: new Fill({ color: "#7a2f00" }), stroke: new Stroke({ color: "#ffffff", width: 4 }) }),
      }),
    });
    const blockLayer = new VectorLayer({
      source: blockSource,
      declutter: 'labels',
      style: (feature) => {
        const blockId = String(feature.get("blockId") ?? feature.get("name") ?? "Block");
        const completion = Number(feature.get("completion") ?? 0);
        return new Style({
          fill: new Fill({ color: colorForCompletion(completion) }),
          stroke: new Stroke({ color: "rgba(244, 249, 255, 0.95)", width: 2 }),
          text: new Text({
            text: `${blockId}\n${completion.toFixed(1)}%`,
            font: "700 13px Arial, sans-serif",
            fill: new Fill({ color: "#ffffff" }),
            stroke: new Stroke({ color: "rgba(5, 12, 33, 0.96)", width: 4 }),
            overflow: true,
          }),
        });
      },
    });
    const map = new OlMap({
      target: mapElementRef.current,
      layers: [satelliteLayer, panelLayer, exclusionLayer, targetLayer, coverageLayer, blockLayer],
      controls: defaultControls({ attributionOptions: { collapsible: false } }),
      view: new View({ center: [0, 0], zoom: 18, maxZoom: 22 }),
    });
    const detachNavigation=attachMapNavigation(map,mapElementRef.current);
    map.getView().fit(blockSource.getExtent()!, {
      padding: [54, 54, 54, 54],
      maxZoom: 18,
      duration: 0,
    });
    const tooltip = document.createElement('div');
    tooltip.className = 'work-date-tooltip'; tooltip.hidden = true;
    mapElementRef.current.appendChild(tooltip);
    map.on('pointermove', event => {
      const feature = map.forEachFeatureAtPixel(event.pixel, f => f, {layerFilter: layer => layer === coverageLayer});
      const date = feature?.get('workDate');
      tooltip.hidden = !date || event.dragging;
      if(date) {
        tooltip.textContent = `Cut on ${displayDate(String(date))}`;
        tooltip.style.left = `${Math.min(event.pixel[0] + 14, (map.getSize()?.[0] || 500) - 160)}px`;
        tooltip.style.top = `${Math.max(8,event.pixel[1] - 34)}px`;
      }
    });
    map.getViewport().addEventListener('pointerleave', () => { tooltip.hidden = true; });
    mapRef.current = map;
    blockLayerRef.current = blockLayer;
    coverageLayerRef.current = coverageLayer;
    panelLayerRef.current = panelLayer;
    exclusionLayerRef.current = exclusionLayer;
    satelliteLayerRef.current = satelliteLayer;
    targetLayerRef.current = targetLayer;
    return () => {
      detachNavigation();
      tooltip.remove();
      map.setTarget(undefined);
      map.dispose();
      mapRef.current = null;
    };
  }, [siteData, preparedSite]);

  useEffect(() => {
    const source = targetLayerRef.current?.getSource();
    if (!source) return;
    source.clear();
    if (activeTarget) source.addFeatures(geometryFormat.readFeatures(activeTarget, { dataProjection:'EPSG:4326', featureProjection:'EPSG:3857' }));
  }, [activeTarget]);

  useEffect(() => {
    const source = coverageLayerRef.current?.getSource();
    if (!source) return;
    source.clear();
    if(preparedSite) source.addFeatures(datedFeatures(visibleDays, preparedSite, rangeStart, rangeEnd));
  }, [visibleDays, preparedSite, rangeStart, rangeEnd]);

  useEffect(() => {
    if (!metrics || !blockLayerRef.current) return;
    const byBlock = new Map(metrics.blocks.map((item) => [item.id, item.completionPct]));
    blockLayerRef.current.getSource()?.getFeatures().forEach((feature) => {
      const blockId = String(feature.get("blockId") ?? feature.get("name"));
      feature.set("completion", byBlock.get(blockId) ?? 0);
    });
    blockLayerRef.current.changed();
  }, [metrics]);

  useEffect(() => void panelLayerRef.current?.setVisible(showPanels), [showPanels]);
  useEffect(() => void exclusionLayerRef.current?.setVisible(showExclusions), [showExclusions]);
  useEffect(() => void satelliteLayerRef.current?.setVisible(showSatellite), [showSatellite]);

  useEffect(() => {
    const layer = satelliteLayerRef.current;
    if (!layer) return;
    const release = wayback.find((item) => item.id === imageryId);
    const source=createImagerySource(release?.url??currentImageryUrl,()=>{
      if(layer.getSource()===source)setImageryNotice('Using lower-resolution imagery where detailed tiles are unavailable.');
    });
    source.on('tileloaderror',()=>{
      if(layer.getSource()===source)setImageryNotice('Satellite tiles could not be loaded. Try another imagery release or check your internet connection.');
    });
    layer.setSource(source);
  }, [imageryId, wayback, siteData, preparedSite]);

  const commitDay = useCallback(
    (next: AreaFeature | null) => {
      const previous = { coverageDays:structuredClone(coverageDaysRef.current), reporting:structuredClone(reportingRef.current) };
      setUndoStack((items) => [...items.slice(-49), previous]);
      setRedoStack([]);
      const clipped = next && preparedSite ? overlap(next, preparedSite.plant) : next;
      const withoutDate = coverageDaysRef.current.filter((day) => day.date !== workDate);
      const updated = clipped
        ? [
            ...withoutDate,
            { date: workDate, geometry: clipped, updatedAt: new Date().toISOString() },
          ].sort((a, b) => a.date.localeCompare(b.date))
        : withoutDate;
      coverageDaysRef.current = updated;
      setCoverageDays(updated);
      setRangeStart((value) => (workDate < value ? workDate : value));
      setRangeEnd((value) => (workDate > value ? workDate : value));
    },
    [preparedSite, workDate],
  );

  const commitTarget = useCallback((next: AreaFeature | null) => {
    if (!siteData || !preparedSite) return;
    const previous = { coverageDays:structuredClone(coverageDaysRef.current), reporting:structuredClone(reportingRef.current) };
    setUndoStack(items => [...items.slice(-49),previous]);
    setRedoStack([]);
    const clipped = next ? overlap(next,preparedSite.plant) : null;
    const existing = reportingRef.current.targets[targetPeriod.key] || {areaHa:null,dueDate:targetPeriod.end,geometry:null};
    const areaHa = clipped ? calculateMetrics(siteData,preparedSite,clipped).overall.completedSqm/10000 : null;
    const updated:Reporting = {...reportingRef.current,targets:{...reportingRef.current.targets,[targetPeriod.key]:{...existing,areaHa,geometry:clipped}}};
    reportingRef.current = updated;
    setReporting(updated);
  },[preparedSite,siteData,targetPeriod]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !preparedSite || tool === "pan") return;
    const sketchSource = new VectorSource();
    const isRectangle = tool === "rectangle";
    const isPolygon = tool === "polygon";
    const isAreaTool = isRectangle || isPolygon;
    const draw = new Draw({
      source: sketchSource,
      type: isRectangle ? "Circle" : isPolygon ? "Polygon" : "LineString",
      freehand: !isAreaTool,
      geometryFunction: isRectangle ? createBox() : undefined,
      style: () => {
        if (isAreaTool) {
          const color = editMode === 'target' ? "rgba(255, 138, 24, 0.9)" : "rgba(110, 218, 255, 0.98)";
          return new Style({
            fill: new Fill({ color: editMode === 'target' ? "rgba(255, 122, 0, 0.24)" : "rgba(0, 174, 239, 0.25)" }),
            stroke: new Stroke({ color, width: 2 }),
          });
        }
        const view = map.getView();
        const resolution = view.getResolution() ?? 1;
        const center = view.getCenter() ?? [0, 0];
        const metersPerPixel = getPointResolution(view.getProjection(), resolution, center, "m");
        const width = Math.max(3, brushMeters / metersPerPixel);
        const color = tool === "erase" ? "rgba(255, 92, 100, 0.7)" : editMode === 'target' ? "rgba(255, 138, 24, 0.76)" : "rgba(0, 174, 239, 0.7)";
        return new Style({
          stroke: new Stroke({ color, width, lineCap: "round", lineJoin: "round" }),
          image: new CircleStyle({ radius: width / 2, fill: new Fill({ color }) }),
        });
      },
    });
    draw.on("drawend", (event) => {
      if (isAreaTool) {
        const polygon = geometryFormat.writeFeatureObject(event.feature, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857",
        }) as AreaFeature;
        const activeGeometry = editMode === 'target' ? activeTarget : activeCoverage;
        const next = combine([...(activeGeometry ? [activeGeometry] : []), polygon]);
        if (editMode === 'target') commitTarget(next); else commitDay(next);
        window.setTimeout(() => sketchSource.clear(), 0);
        return;
      }
      const raw = geometryFormat.writeFeatureObject(event.feature, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      }) as Feature<LineString>;
      if (raw.geometry.coordinates.length < 2) return;
      const stroke = buffer(lineString(raw.geometry.coordinates), brushMeters / 2, {
        units: "meters",
        steps: 12,
      }) as AreaFeature | undefined;
      if (!stroke) return;
      const activeGeometry = editMode === 'target' ? activeTarget : activeCoverage;
      const next = tool === "paint" ? combine([...(activeGeometry ? [activeGeometry] : []), stroke]) : subtract(activeGeometry, stroke);
      if (editMode === 'target') commitTarget(next); else commitDay(next);
      window.setTimeout(() => sketchSource.clear(), 0);
    });
    map.addInteraction(draw);
    return () => { map.removeInteraction(draw); };
  }, [activeCoverage, activeTarget, brushMeters, commitDay, commitTarget, editMode, preparedSite, tool]);

  const undo = () => {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((items) => items.slice(0, -1));
    setRedoStack((items) => [...items, {coverageDays:structuredClone(coverageDaysRef.current),reporting:structuredClone(reportingRef.current)}]);
    coverageDaysRef.current = previous.coverageDays;
    reportingRef.current = previous.reporting;
    setCoverageDays(previous.coverageDays);
    setReporting(previous.reporting);
  };

  const redo = () => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((items) => items.slice(0, -1));
    setUndoStack((items) => [...items, {coverageDays:structuredClone(coverageDaysRef.current),reporting:structuredClone(reportingRef.current)}]);
    coverageDaysRef.current = next.coverageDays;
    reportingRef.current = next.reporting;
    setCoverageDays(next.coverageDays);
    setReporting(next.reporting);
  };

  const updateDetails = (key: keyof ReportDetails, value: string) =>
    setDetails((current) => ({ ...current, [key]: value }));

  const buildProject = (): SavedProject => ({
    id: "current",
    version: 3,
    updatedAt: new Date().toISOString(),
    brushMeters,
    coverageDays,
    workDate,
    rangeStart,
    rangeEnd,
    imageryId,
    details,
    reporting,
  });

  const returnToReports=async()=>{
    if(returning||printing)return;
    if(!hydrated){onBack();return;}
    setReturning(true);window.clearTimeout(saveTimerRef.current);
    try{
      // Flush the debounce before unmounting, so a recent stroke stays saved.
      await projectDb.projects.put(buildProject());onBack();
    }catch{
      setSaveState('Could not save before returning. Export history and try again.');
      setReturning(false);
    }
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(buildProject(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `armenia-grasscut-history-${details.reportDate || today}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as SavedProject | LegacyProject;
      if (raw.version !== 1 && raw.version !== 2 && raw.version !== 3) throw new Error("Unsupported history file.");
      const imported = normalizeProject(raw);
      coverageDaysRef.current = imported.coverageDays;
      setCoverageDays(imported.coverageDays);
      setBrushMeters(Math.min(100, Math.max(1, Number(imported.brushMeters) || 20)));
      setWorkDate(imported.workDate);
      setRangeStart(imported.rangeStart);
      setRangeEnd(imported.rangeEnd);
      setImageryId(imported.imageryId);
      setDetails({ ...defaultDetails, ...imported.details });
      const importedReporting = normalizeReporting(imported.reporting, imported.details);
      reportingRef.current = importedReporting;
      setReporting(importedReporting);
      setUndoStack([]);
      setRedoStack([]);
      setSaveState(`Imported ${imported.coverageDays.length} dated record(s)`);
    } catch {
      setSaveState("Could not import that history file");
    }
  };

  const printReport = async () => {
    if (!siteData || !preparedSite || !metrics || printing) return;
    setPrinting(true); setSaveState('Preparing two report maps…');
    try {
      await document.fonts.load("600 12px Figtree");
      await document.fonts.ready;
      const shared = { data:siteData, site:preparedSite, start:rangeStart, end:rangeEnd,
        imageryUrl:selectedImagery?.url || currentImageryUrl, satellite:showSatellite, target:activeTarget };
      const overview = await renderReportMap({...shared, days:visibleDays, extent:reportExtent || preparedSite.plant, blocks:metrics.blocks, zoomInFraction:0.1});
      const latestExtent = latestDay ? buffer(latestDay.geometry,120,{units:'meters',steps:8}) as AreaFeature | undefined : undefined;
      const latest = latestDay && latestMetrics ? await renderReportMap({...shared,days:visibleDays,extent:latestExtent || latestDay.geometry,blocks:latestMetrics.blocks}) : null;
      setMapSnapshot(overview.image); setLatestSnapshot(latest?.image || null);
      setImageryIncomplete(overview.imageryIncomplete || !!latest?.imageryIncomplete);
      setReportReady(true);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.print-report img')).map(img=>img.decode().catch(()=>undefined)));
      window.print();
      setSaveState('Report ready');
    } catch(error) {
      setSaveState(error instanceof Error ? `Report failed: ${error.message}` : 'Could not prepare report. Try again.');
    } finally { setPrinting(false); }
  };

  const visibleError = loadError ?? preparedSiteResult.error;
  if (visibleError) {
    return (
      <main className="loading-screen">
        <div className="error-card"><strong>Unable to open the plant map</strong><p>{visibleError}</p></div>
        <Button variant="outline" onClick={returnToReports} disabled={returning}><ArrowLeft aria-hidden="true"/>Reports</Button>
      </main>
    );
  }
  if (!siteData || !preparedSite || !metrics) {
    return (
      <main className="loading-screen">
        <LoaderCircle className="loading-spinner" aria-hidden="true" />
        <p>Preparing plant geometry…</p>
        <Button variant="outline" onClick={returnToReports} disabled={returning}><ArrowLeft aria-hidden="true"/>Reports</Button>
      </main>
    );
  }

  const imageryYears = Array.from(
    new Set(wayback.map((release) => Number(release.releaseDate.slice(0, 4)))),
  ).sort((a, b) => b - a);
  const coveragePeriod = `${displayDate(rangeStart)} to ${displayDate(rangeEnd)}`;

  return (
    <>
      <main className="app-shell screen-only">
        <header className="app-header">
          <div className="app-header-title"><Button variant="outline" size="sm" onClick={returnToReports} disabled={returning||printing}><ArrowLeft aria-hidden="true"/>Reports</Button><div><div className="eyebrow">O&amp;M Field Reporting</div><h1>Grass-Cutting Progress</h1></div></div>
          <div className="header-actions">
            <span className="save-state">{saveState}</span>
            <input ref={fileInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={importBackup} />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}><Upload aria-hidden="true" /> Import history</Button>
            <Button variant="outline" size="sm" onClick={exportBackup}><Download aria-hidden="true" /> Export history</Button>
            <Button size="sm" onClick={printReport} disabled={printing}><Printer aria-hidden="true" /> Export PDF</Button>
          </div>
        </header>

        <section className="summary-strip" aria-label="Plant progress summary">
          <div className="primary-stat"><span>Completion · {coveragePeriod}</span><strong>{percent(metrics.overall.completionPct)}</strong><Progress value={metrics.overall.completionPct} /></div>
          <div><span>Completed</span><strong>{hectares(metrics.overall.completedSqm)} ha</strong></div>
          <div><span>Workable area</span><strong>{hectares(metrics.overall.workableSqm)} ha</strong></div>
          <div><span>Gross plant area</span><strong>{hectares(metrics.overall.grossSqm)} ha</strong></div>
        </section>

        <div className="workspace">
          <section className="map-panel">
            <div className="map-toolbar" aria-label="Map tools">
              <div className="edit-mode-switch" aria-label="Drawing layer">
                <Button variant={editMode === "completed" ? "default" : "outline"} size="sm" onClick={() => setEditMode("completed")}><Brush aria-hidden="true" /> Completed work</Button>
                <Button variant={editMode === "target" ? "default" : "outline"} size="sm" onClick={() => setEditMode("target")}><Flag aria-hidden="true" /> Target area</Button>
              </div>
              <div className="tool-group">
                <Button variant={tool === "pan" ? "default" : "outline"} size="sm" onClick={() => setTool("pan")}><Hand aria-hidden="true" /> Pan</Button>
                <Button variant={tool === "paint" ? "default" : "outline"} size="sm" onClick={() => setTool("paint")}><Brush aria-hidden="true" /> Paint</Button>
                <Button variant={tool === "rectangle" ? "default" : "outline"} size="sm" onClick={() => setTool("rectangle")} title="Drag corner to corner"><RectangleHorizontal aria-hidden="true" /> Rectangle</Button>
                <Button variant={tool === "polygon" ? "default" : "outline"} size="sm" onClick={() => setTool("polygon")} title="Click each corner and double-click to finish"><Pentagon aria-hidden="true" /> Polygon</Button>
                <Button variant={tool === "erase" ? "destructive" : "outline"} size="sm" onClick={() => setTool("erase")}><Eraser aria-hidden="true" /> Erase</Button>
              </div>
              <div className="brush-control">
                <label htmlFor="brush-size">Brush</label>
                <Slider id="brush-size" min={1} max={100} step={1} value={[brushMeters]} onValueChange={(values) => setBrushMeters(values[0] ?? 20)} aria-label="Brush width in meters" disabled={tool === "rectangle" || tool === "polygon"} />
                <Input type="number" min={1} max={100} value={brushMeters} onChange={(event) => setBrushMeters(Math.min(100, Math.max(1, Number(event.target.value) || 1)))} aria-label="Brush width" disabled={tool === "rectangle" || tool === "polygon"} />
                <span>m</span>
              </div>
              <div className="tool-group toolbar-end">
                <Button variant="outline" size="icon-sm" onClick={undo} disabled={!undoStack.length} aria-label="Undo"><Undo2 aria-hidden="true" /></Button>
                <Button variant="outline" size="icon-sm" onClick={redo} disabled={!redoStack.length} aria-label="Redo"><Redo2 aria-hidden="true" /></Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button variant="outline" size="icon-sm" disabled={!(editMode === 'target' ? activeTarget : activeCoverage)} aria-label={editMode === 'target' ? 'Clear target area' : 'Clear active date'}><Trash2 aria-hidden="true" /></Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>{editMode === 'target' ? 'Clear the target area?' : `Clear coverage for ${workDate}?`}</AlertDialogTitle><AlertDialogDescription>{editMode === 'target' ? `The drawn ${reporting.targetPeriod} target will be removed. Undo remains available.` : 'Only this work date will be cleared. Other historical dates stay intact, and Undo remains available.'}</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => editMode === 'target' ? commitTarget(null) : commitDay(null)}>{editMode === 'target' ? 'Clear target' : 'Clear date'}</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            <div className="imagery-control">
              <Satellite aria-hidden="true" />
              <label htmlFor="imagery-release">Esri imagery date</label>
              <NativeSelect id="imagery-release" value={imageryId} onChange={(event) => {setImageryNotice('');setImageryId(event.target.value);}}>
                <NativeSelectOption value={CURRENT_IMAGERY_ID}>Current World Imagery</NativeSelectOption>
                {imageryYears.map((year) => (
                  <NativeSelectOptGroup key={year} label={String(year)}>
                    {wayback.filter((release) => Number(release.releaseDate.slice(0, 4)) === year).map((release) => <NativeSelectOption key={release.id} value={release.id}>{release.label}</NativeSelectOption>)}
                  </NativeSelectOptGroup>
                ))}
              </NativeSelect>
              <span>Archive date identifies the Esri release, not necessarily the image capture date.</span>
            </div>
            <div className={`map-editor tool-${tool}`} ref={mapElementRef} tabIndex={0} role="region" aria-label="Grass-cutting map. Use W A S D to pan."/>
            <div className="map-navigation-hint">Hover over or focus the map, then hold W A S D to pan. Typing in report fields keeps keyboard navigation inactive.</div>
            {showSatellite&&imageryNotice&&<p className="map-imagery-notice" role="status">{imageryNotice}</p>}
            <div className="map-legend">
              <label><Checkbox checked={showSatellite} onCheckedChange={(checked) => setShowSatellite(checked === true)} /><Satellite aria-hidden="true" /> Satellite</label>
              <label><Checkbox checked={showPanels} onCheckedChange={(checked) => setShowPanels(checked === true)} /><span className="legend-swatch panel" /> Panels · 28.6%</label>
              <label><Checkbox checked={showExclusions} onCheckedChange={(checked) => setShowExclusions(checked === true)} /><span className="legend-swatch exclusion" /> Excluded · 0%</label>
              <span className="legend-item"><span className="legend-swatch target" /> {reporting.targetPeriod[0].toUpperCase()+reporting.targetPeriod.slice(1)} target</span>
              <span className="legend-item"><span className="history-gradient" /> Older → newer work</span>
            </div>
          </section>

          <aside className="side-panel">
            <section className="panel-section history-section">
              <div className="section-heading"><div><span className="section-kicker">Historical progress</span><h2>Dates</h2></div><History aria-hidden="true" /></div>
              <div className="history-grid">
                <label>Work date<Input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} /></label>
                <label>View from<Input type="date" value={rangeStart} max={rangeEnd} onChange={(event) => setRangeStart(event.target.value)} /></label>
                <label>View to<Input type="date" value={rangeEnd} min={rangeStart} onChange={(event) => setRangeEnd(event.target.value)} /></label>
              </div>
              <p className="field-help">New drawing is recorded on the work date. Metrics and the color gradient use only the selected view period.</p>
              <div className="history-summary"><strong>{visibleDays.length}</strong><span>dated record{visibleDays.length === 1 ? "" : "s"} visible</span></div>
            </section>

            <section className="panel-section">
              <div className="section-heading"><div><span className="section-kicker">Report</span><h2>Details</h2></div></div>
              <div className="form-grid">
                <label>Report title<Input value={details.title} onChange={(event) => updateDetails("title", event.target.value)} /></label>
                <label>Report date<Input type="date" value={details.reportDate} onChange={(event) => { if(event.target.value) updateDetails("reportDate", event.target.value); }} /></label>

                <label>Team / contractor<Input value={details.team} onChange={(event) => updateDetails("team", event.target.value)} placeholder="Team name" /></label>
                <label>Remarks<Textarea value={details.remarks} onChange={(event) => updateDetails("remarks", event.target.value)} placeholder="Work summary or site notes" rows={3} /></label>
              </div>
            </section>

            <ReportEditor value={reporting} onChange={setReporting} reportDate={details.reportDate || today} actualHa={(targetMetrics?.overall.completedSqm || 0)/10000} hasTargetGeometry={!!activeTarget} onError={setSaveState}/>

            <section className="panel-section block-section">
              <div className="section-heading"><div><span className="section-kicker">Area-weighted</span><h2>Block completion</h2></div><Layers3 aria-hidden="true" /></div>
              <div className="block-list">
                {metrics.blocks.map((block) => (
                  <article className="block-row" key={block.id}>
                    <div className="block-row-head"><strong>{block.id}</strong><span>{percent(block.completionPct)}</span></div>
                    <Progress value={block.completionPct} />
                    <div className="block-meta">{hectares(block.completedSqm)} / {hectares(block.workableSqm)} ha</div>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>

      {reportReady && <PrintableReport details={details} reporting={reporting} blocks={metrics.blocks} overall={metrics.overall}
        rangeStart={rangeStart} rangeEnd={rangeEnd} latestDate={latestDay?.date || ''} latestHa={(latestMetrics?.overall.completedSqm || 0)/10000}
        actualHa={(targetMetrics?.overall.completedSqm || 0)/10000} overview={mapSnapshot} latest={latestSnapshot}
        imageryLabel={selectedImagery?.label || 'Current World Imagery'} imageryIncomplete={imageryIncomplete}/>}

    </>
  );
}
