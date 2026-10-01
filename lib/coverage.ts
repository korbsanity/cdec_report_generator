import {
  area,
  difference,
  featureCollection,
  intersect,
  union,
} from "@turf/turf";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  MultiPolygon,
  Polygon,
} from "geojson";

export type AreaGeometry = Polygon | MultiPolygon;
export type AreaFeature = Feature<AreaGeometry, GeoJsonProperties>;

export interface SiteGeometryData {
  metadata: {
    panelWeight: number;
    sourceNote: string;
  };
  blocks: FeatureCollection<Polygon>;
  panels: FeatureCollection<Polygon>;
  exclusions: FeatureCollection<Polygon>;
}

export interface PreparedSite {
  panelWeight: number;
  plant: AreaFeature;
  panels: AreaFeature | null;
  exclusions: AreaFeature | null;
  ordinary: AreaFeature | null;
}

export interface CoverageMetric {
  id: string;
  grossSqm: number;
  panelSqm: number;
  excludedSqm: number;
  workableSqm: number;
  completedSqm: number;
  completionPct: number;
}

export function combine(features: AreaFeature[]): AreaFeature | null {
  if (features.length === 0) return null;
  if (features.length === 1) return structuredClone(features[0]);
  return union(featureCollection(features)) as AreaFeature | null;
}

export function overlap(a: AreaFeature | null, b: AreaFeature | null): AreaFeature | null {
  if (!a || !b) return null;
  return intersect(featureCollection([a, b])) as AreaFeature | null;
}

export function subtract(a: AreaFeature | null, b: AreaFeature | null): AreaFeature | null {
  if (!a) return null;
  if (!b) return structuredClone(a);
  return difference(featureCollection([a, b])) as AreaFeature | null;
}

export function featureArea(feature: AreaFeature | null): number {
  return feature ? area(feature) : 0;
}

export function prepareSite(data: SiteGeometryData): PreparedSite {
  const plant = combine(data.blocks.features as AreaFeature[]);
  if (!plant) throw new Error("The site has no valid plant blocks.");

  const rawExclusions = combine(data.exclusions.features as AreaFeature[]);
  const exclusions = overlap(rawExclusions, plant);
  const rawPanels = combine(data.panels.features as AreaFeature[]);
  const panelsInsidePlant = overlap(rawPanels, plant);
  const panels = subtract(panelsInsidePlant, exclusions);
  const plantAfterExclusions = subtract(plant, exclusions);
  const ordinary = subtract(plantAfterExclusions, panels);

  return {
    panelWeight: data.metadata.panelWeight,
    plant,
    panels,
    exclusions,
    ordinary,
  };
}

function metricForRegion(
  id: string,
  region: AreaFeature,
  site: PreparedSite,
  coverage: AreaFeature | null,
): CoverageMetric {
  const excludedRegion = overlap(region, site.exclusions);
  const regionAfterExclusions = subtract(region, excludedRegion);
  const panelRegion = overlap(regionAfterExclusions, site.panels);
  const ordinaryRegion = subtract(regionAfterExclusions, panelRegion);

  const completedOrdinary = overlap(coverage, ordinaryRegion);
  const completedPanel = overlap(coverage, panelRegion);
  const workableSqm =
    featureArea(ordinaryRegion) + site.panelWeight * featureArea(panelRegion);
  const completedSqm =
    featureArea(completedOrdinary) + site.panelWeight * featureArea(completedPanel);

  return {
    id,
    grossSqm: featureArea(region),
    panelSqm: featureArea(panelRegion),
    excludedSqm: featureArea(excludedRegion),
    workableSqm,
    completedSqm,
    completionPct:
      workableSqm > 0 ? Math.min(100, (completedSqm / workableSqm) * 100) : 0,
  };
}

export function calculateMetrics(
  data: SiteGeometryData,
  site: PreparedSite,
  coverage: AreaFeature | null,
): { overall: CoverageMetric; blocks: CoverageMetric[] } {
  const grouped = new Map<string, AreaFeature[]>();
  data.blocks.features.forEach((section) => {
    const name = String(section.properties?.name ?? "Unassigned");
    const blockId = String(section.properties?.blockId ?? name.match(/^B\d+/i)?.[0] ?? name);
    grouped.set(blockId, [...(grouped.get(blockId) ?? []), section as AreaFeature]);
  });

  const blocks = Array.from(grouped.entries())
    .map(([blockId, sections]) => {
      const region = combine(sections);
      if (!region) throw new Error(`Block ${blockId} has no valid geometry.`);
      return metricForRegion(blockId, region, site, coverage);
    })
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  return {
    overall: metricForRegion("Entire plant", site.plant, site, coverage),
    blocks,
  };
}

export function hectares(squareMeters: number): string {
  return (squareMeters / 10_000).toFixed(3);
}
