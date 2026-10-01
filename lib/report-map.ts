import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import { createImagerySource } from './imagery';
import VectorSource from 'ol/source/Vector.js';
import { Fill, Stroke, Style, Text } from 'ol/style.js';
import type { FeatureLike } from 'ol/Feature.js';
import type { AreaFeature, CoverageMetric, PreparedSite, SiteGeometryData } from './coverage';
import { combine } from './coverage';
import type { CoverageDay } from './db';
import { datedVisibleAreas, displayDate, historyColor } from './reporting';

export { imageryAttribution, currentImageryUrl } from './imagery';
const format = new GeoJSON();
const projection = { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' };

export function coverageStyle(feature: FeatureLike) {
  const color = String(feature.get('historyColor') || '#2e3192');
  return new Style({
    fill: new Fill({color}), stroke: new Stroke({color, width: 1.2}),
    text: new Text({
      text: displayDate(String(feature.get('workDate') || '')),
      font: '700 13px Figtree, Calibri, sans-serif', overflow: true,
      fill: new Fill({color:'#14223a'}), stroke: new Stroke({color:'#ffffff',width:3}),
      backgroundFill: new Fill({color:'rgba(255,255,255,0.9)'}), padding:[3,4,3,4],
    }),
  });
}

export function datedFeatures(days: CoverageDay[], site: PreparedSite, start: string, end: string) {
  return datedVisibleAreas(days, site.exclusions).flatMap(day => {
    // Split disjoint parts so each cut area gets its own date label.
    const parts = day.geometry.geometry.type === 'MultiPolygon'
      ? day.geometry.geometry.coordinates.map(coordinates => ({type:'Feature', properties:{}, geometry:{type:'Polygon',coordinates}}))
      : [day.geometry];
    return parts.flatMap(part => format.readFeatures(part, projection)).map(feature => {
      feature.set('workDate', day.date);
      feature.set('historyColor', historyColor(day.date, start, end));
      return feature;
    });
  });
}

export interface ReportMapResult { image: string; imageryIncomplete: boolean }

// A separate fixed-size map makes print framing independent of the editor's zoom.
export async function renderReportMap(options: {
  data: SiteGeometryData; site: PreparedSite; days: CoverageDay[];
  extent: AreaFeature; start: string; end: string; imageryUrl: string;
  satellite: boolean; blocks: CoverageMetric[]; target?: AreaFeature | null; zoomInFraction?: number;
}): Promise<ReportMapResult> {
  const target = document.createElement('div');
  Object.assign(target.style, { position:'fixed',left:'-10000px',top:'0',width:'1400px',height:'750px',background:'#edf2f8' });
  document.body.appendChild(target);
  const vectors = (features: AreaFeature[]) => new VectorSource({features:format.readFeatures({type:'FeatureCollection',features},projection)});
  const tileSource = createImagerySource(options.imageryUrl);
  let tileErrors = false;
  tileSource.on('tileloaderror', () => {tileErrors = true;});
  const grouped = new Map<string,AreaFeature[]>();
  options.data.blocks.features.forEach(f => {
    const id = String(f.properties?.blockId ?? f.properties?.name);
    grouped.set(id,[...(grouped.get(id) || []),f]);
  });
  const blocks = Array.from(grouped,([id,sections]) => ({...combine(sections)!,properties:{name:id}}));
  const layers = [
    new TileLayer({source:tileSource,visible:options.satellite,preload:1}),
    new VectorLayer({source:vectors(options.site.panels ? [options.site.panels] : []),style:new Style({stroke:new Stroke({color:'#ffc857',width:1}),fill:new Fill({color:'rgba(255,200,87,0.07)'})})}),
    new VectorLayer({source:vectors(options.site.exclusions ? [options.site.exclusions] : []),style:new Style({fill:new Fill({color:'rgba(222,70,77,0.65)'}),stroke:new Stroke({color:'#e0555d',width:1})})}),
    new VectorLayer({source:vectors(options.target ? [options.target] : []),style:new Style({
      fill:new Fill({color:'rgba(255,122,0,0.12)'}),
      stroke:new Stroke({color:'#ff7a00',width:3,lineDash:[12,7]}),
      text:new Text({text:'TARGET',font:'800 14px Figtree, Calibri, sans-serif',overflow:true,fill:new Fill({color:'#8a3600'}),stroke:new Stroke({color:'#ffffff',width:4})}),
    })}),
    new VectorLayer({source:new VectorSource({features:datedFeatures(options.days,options.site,options.start,options.end)}),style:coverageStyle}),
    new VectorLayer({source:vectors(blocks),declutter:'labels',style:f => new Style({
      stroke:new Stroke({color:options.satellite?'#ffffff':'#27336c',width:2}),
      text:new Text({text:`${f.get('name')} · ${(options.blocks.find(b=>b.id===f.get('name'))?.completionPct || 0).toFixed(1)}%`,font:'700 15px Figtree, Calibri, sans-serif',fill:new Fill({color:'#172347'}),stroke:new Stroke({color:'#ffffff',width:4}),overflow:true})
    })}),
  ];
  const map = new OlMap({target,layers,controls:[],interactions:[],pixelRatio:1,view:new View({maxZoom:19})});
  try {
    const extent = format.readFeatures(options.extent,projection)[0].getGeometry()!.getExtent();
    map.updateSize();
    map.getView().fit(extent,{padding:[45,45,45,45],maxZoom:19,duration:0});
    if (options.zoomInFraction && options.zoomInFraction > 0 && options.zoomInFraction < 1) {
      map.getView().adjustZoom(Math.log2(1 / (1 - options.zoomInFraction)));
    }
    const complete = await new Promise<boolean>(resolve => {
      let finished = false;
      const timer = window.setTimeout(() => finish(false),12000);
      const finish = (ok:boolean) => {if(finished)return;finished=true;clearTimeout(timer);resolve(ok);};
      map.once('rendercomplete',() => finish(true)); map.renderSync();
    });
    const canvas = document.createElement('canvas');canvas.width=1400;canvas.height=750;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#edf2f8';ctx.fillRect(0,0,1400,750);
    target.querySelectorAll<HTMLCanvasElement>('.ol-layer canvas').forEach(layer => {
      if(!layer.width)return;
      ctx.globalAlpha=Number(layer.parentElement?.style.opacity || 1);
      const cssWidth = Number.parseFloat(layer.style.width);
      const cssHeight = Number.parseFloat(layer.style.height);
      const scaleX = Number.isFinite(cssWidth) && layer.width ? cssWidth / layer.width : 1;
      const scaleY = Number.isFinite(cssHeight) && layer.height ? cssHeight / layer.height : 1;
      const transform = layer.style.transform ? new DOMMatrix(layer.style.transform) : new DOMMatrix().scale(scaleX,scaleY);
      ctx.setTransform(transform);ctx.drawImage(layer,0,0);
    });
    return {image:canvas.toDataURL('image/png'),imageryIncomplete:options.satellite&&(!complete||tileErrors)};
  } finally { map.setTarget(undefined);map.dispose();target.remove(); }
}
