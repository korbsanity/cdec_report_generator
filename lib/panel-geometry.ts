import { convex, featureCollection, intersect, polygon, multiPolygon } from '@turf/turf';
import type { Feature, Polygon, MultiPolygon, FeatureCollection, Position } from 'geojson';

export interface RowProperties { id: string; row: string; block: string; sourceName: string }
export interface PanelDataset extends FeatureCollection<Polygon, RowProperties> {
  metadata: {
    datasetId: string; geometryVersion: number; fullTableMeters: number; tableIncrement: number;
    blocks: {block:string;rows:number;actualTables:number;sourceFiles:string[]}[];
    warnings: string[]; source: string;
  };
}
export const QUARTERS_PER_TABLE = 4;
export const TABLE_INCREMENT = 1 / QUARTERS_PER_TABLE;
export type SelectionPrecision = 'table' | 'half' | 'quarter';
export interface QuarterProperties {
  id: string; rowId: string; row: string; block: string; table: number; quarter: number;
  weight: number; lengthMeters: number; estimatedTables: number; residualMeters: number;
}
export type QuarterFeature = Feature<Polygon | MultiPolygon, QuarterProperties>;
export const sumTables = (features: QuarterFeature[]) => features.reduce((sum, f) => sum + f.properties.weight, 0);

// Expand a clicked quarter to its physical table/half, or require the whole unit
// to lie inside a drawn selection. Short row ends remain fractional units.
export function selectionUnits(features: QuarterFeature[], matched: Set<string>, precision: SelectionPrecision, fullyEnclosed = false): Set<string> {
  const width = precision === 'table' ? 4 : precision === 'half' ? 2 : 1;
  const groups = new Map<string, string[]>();
  for (const {properties:p} of features) {
    const key = `${p.rowId}:${p.table}:${Math.floor((p.quarter - 1) / width)}`;
    const ids = groups.get(key) || [];
    ids.push(p.id); groups.set(key, ids);
  }
  const selected = new Set<string>();
  for (const ids of groups.values()) {
    if (fullyEnclosed ? ids.every(id=>matched.has(id)) : ids.some(id=>matched.has(id))) {
      ids.forEach(id=>selected.add(id));
    }
  }
  return selected;
}

// Work in a local metric plane, then convert back to geographic coordinates.
// The minimum-area rectangle follows the traced row rather than the map axes.
export function segmentRow(row: Feature<Polygon, RowProperties>, pitch: number): QuarterFeature[] {
  if (!Number.isFinite(pitch) || pitch <= 0) throw new Error('Table pitch must be positive.');
  const origin = row.geometry.coordinates[0][0];
  const sx = 111320 * Math.cos(origin[1] * Math.PI / 180), sy = 110574;
  const rounded=(n:number)=>Math.round(n*1e6)/1e6;
  const metric = row.geometry.coordinates.map(ring => ring.map(p => [rounded((p[0]-origin[0])*sx), rounded((p[1]-origin[1])*sy)]));
  const hull = convex(polygon(metric));
  if (!hull) throw new Error(`${row.properties.row}: degenerate row polygon.`);
  const points = hull.geometry.coordinates[0];
  let best: {u:number[]; v:number[]; a:number; b:number; c:number; d:number; area:number} | undefined;
  for (let i=0; i<points.length-1; i++) {
    const dx=points[i+1][0]-points[i][0], dy=points[i+1][1]-points[i][1], len=Math.hypot(dx,dy);
    if (len<1e-7) continue;
    const u=[dx/len,dy/len], v=[-u[1],u[0]];
    const along=points.map(p=>p[0]*u[0]+p[1]*u[1]), across=points.map(p=>p[0]*v[0]+p[1]*v[1]);
    const a=Math.min(...along),b=Math.max(...along),c=Math.min(...across),d=Math.max(...across);
    const area=(b-a)*(d-c);
    if (!best || area<best.area) best={u,v,a,b,c,d,area};
  }
  if (!best) throw new Error(`${row.properties.row}: invalid row extent.`);
  let {u,v}=best;
  if (best.d-best.c>best.b-best.a) {u=best.v;v=[-u[1],u[0]];}
  // Stable west-to-east (or south-to-north) indexing, independent of ring winding.
  if (u[0]<0 || (Math.abs(u[0])<1e-8 && u[1]<0)) {u=[-u[0],-u[1]];v=[-v[0],-v[1]];}
  const along=points.map(p=>p[0]*u[0]+p[1]*u[1]), across=points.map(p=>p[0]*v[0]+p[1]*v[1]);
  const a=Math.min(...along),b=Math.max(...along),c=Math.min(...across)-1,d=Math.max(...across)+1;
  const length=b-a, quarters=Math.max(1,Math.round(length/pitch*QUARTERS_PER_TABLE));
  const projected=polygon(metric), result:QuarterFeature[]=[];
  const geographic=(p:Position)=>[p[0]/sx+origin[0],p[1]/sy+origin[1]];
  for (let q=0;q<quarters;q++) {
    const start=a+length*q/quarters-(q===0?0.1:0), end=a+length*(q+1)/quarters+(q===quarters-1?0.1:0);
    const coordinate=(x:number,y:number)=>[rounded(u[0]*x+v[0]*y),rounded(u[1]*x+v[1]*y)];
    const clip=polygon([[coordinate(start,c),coordinate(end,c),coordinate(end,d),coordinate(start,d),coordinate(start,c)]]);
    const cut=intersect(featureCollection([projected,clip]));
    if (!cut) throw new Error(`${row.properties.row}: missing quarter ${q+1}.`);
    const geometry=cut.geometry.type==='Polygon'
      ? polygon(cut.geometry.coordinates.map(r=>r.map(geographic))).geometry
      : multiPolygon(cut.geometry.coordinates.map(p=>p.map(r=>r.map(geographic)))).geometry;
    result.push({type:'Feature',geometry,properties:{
      id:`${row.properties.id}-Q${String(q+1).padStart(3,'0')}`, rowId:row.properties.id,
      row:row.properties.row,block:row.properties.block,table:Math.floor(q/QUARTERS_PER_TABLE)+1,quarter:q%QUARTERS_PER_TABLE+1,
      weight:TABLE_INCREMENT,lengthMeters:length,estimatedTables:quarters/QUARTERS_PER_TABLE,residualMeters:length-quarters*pitch/QUARTERS_PER_TABLE,
    }});
  }
  return result;
}
