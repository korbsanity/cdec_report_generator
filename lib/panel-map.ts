import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import Feature from 'ol/Feature.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Point from 'ol/geom/Point.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import {createImagerySource} from './imagery';
import {Fill,Stroke,Style,Text} from 'ol/style.js';
import {createEmpty,extend,getCenter} from 'ol/extent.js';
import type {FeatureLike} from 'ol/Feature.js';
import type {QuarterFeature} from './panel-geometry';
import type {CleaningRound} from './panel-project';
import {displayDate} from './reporting';
import type {ReportMapResult} from './report-map';

export function panelStyle(f:FeatureLike,resolution:number) {
  const selected=!!f.get('selected'),completed=!!f.get('workDate'),target=!!f.get('target');
  return new Style({
    fill:new Fill({color:selected?'rgba(250,204,21,.65)':completed?'rgba(34,197,94,.60)':target?'rgba(14,165,233,.50)':'rgba(255,255,255,.06)'}),
    stroke:new Stroke({color:selected?'#fde047':target?'#38bdf8':completed?'#16a34a':'#e2e8f0',width:selected?2:target?1.5:0.7,lineDash:target?[5,3]:undefined}),
    text:resolution<.45&&f.get('quarter')===1?new Text({text:`T${f.get('table')}`,font:'600 10px Arial',fill:new Fill({color:'#162244'}),stroke:new Stroke({color:'#fff',width:3})}):undefined,
  });
}

export function makePanelSources(features:QuarterFeature[],round:CleaningRound,start:string,end:string,targetIds:string[]) {
  const target=new Set(targetIds), format=new GeoJSON();
  const parsed=format.readFeatures({type:'FeatureCollection',features},{dataProjection:'EPSG:4326',featureProjection:'EPSG:3857'});
  const groups=new Map<string,{date:string;extent:number[]}>();
  for(const f of parsed){
    const date=round.completed[String(f.get('id'))];const visible=date&&date>=start&&date<=end?date:'';
    f.setProperties({workDate:visible,target:target.has(String(f.get('id'))),selected:false});
    if(visible){const key=`${f.get('rowId')}:${visible}`;let group=groups.get(key);
      if(!group){group={date:visible,extent:createEmpty()};groups.set(key,group);}extend(group.extent,f.getGeometry()!.getExtent());}
  }
  const labels=[...groups.values()].map(group=>new Feature({geometry:new Point(getCenter(group.extent)),date:group.date}));
  return {tables:new VectorSource({features:parsed}),labels:new VectorSource({features:labels})};
}
export const panelDateStyle=(f:FeatureLike)=>new Style({text:new Text({text:displayDate(String(f.get('date'))),font:'700 11px Arial',fill:new Fill({color:'#122342'}),stroke:new Stroke({color:'#fff',width:3}),backgroundFill:new Fill({color:'rgba(255,255,255,.85)'}),padding:[2,3,2,3]})});

export async function renderPanelMap(features:QuarterFeature[],round:CleaningRound,start:string,end:string,targetIds:string[],imageryUrl:string,satellite:boolean,focusIds?:Set<string>):Promise<ReportMapResult>{
  const sources=makePanelSources(features,round,start,end,targetIds);
  const target=document.createElement('div');Object.assign(target.style,{position:'fixed',left:'-10000px',top:'0',width:'1400px',height:'750px',background:'#edf2f8'});document.body.appendChild(target);
  const tiles=createImagerySource(imageryUrl);let errors=false;tiles.on('tileloaderror',()=>{errors=true;});
  const map=new OlMap({target,pixelRatio:1,controls:[],interactions:[],layers:[new TileLayer({source:tiles,visible:satellite,preload:1}),new VectorLayer({source:sources.tables,style:panelStyle}),new VectorLayer({source:sources.labels,style:panelDateStyle,declutter:true})],view:new View({maxZoom:19})});
  try{
    const extent=createEmpty();sources.tables.getFeatures().filter(f=>!focusIds||focusIds.has(String(f.get('id')))).forEach(f=>extend(extent,f.getGeometry()!.getExtent()));
    map.updateSize();map.getView().fit(extent,{padding:focusIds?[110,110,110,110]:[25,25,25,25],maxZoom:19,duration:0});
    const complete=await new Promise<boolean>(resolve=>{let finished=false;const finish=(ok:boolean)=>{if(finished)return;finished=true;window.clearTimeout(timer);resolve(ok);};const timer=window.setTimeout(()=>finish(false),12000);map.once('rendercomplete',()=>finish(true));map.renderSync();});
    const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=750;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#edf2f8';ctx.fillRect(0,0,1400,750);
    target.querySelectorAll<HTMLCanvasElement>('.ol-layer canvas').forEach(layer=>{
      if(!layer.width)return;ctx.globalAlpha=Number(layer.parentElement?.style.opacity||1);
      ctx.setTransform(layer.style.transform?new DOMMatrix(layer.style.transform):new DOMMatrix());ctx.drawImage(layer,0,0);
    });
    return {image:canvas.toDataURL('image/png'),imageryIncomplete:satellite&&(!complete||errors)};
  }finally{map.setTarget(undefined);map.dispose();target.remove();}
}
