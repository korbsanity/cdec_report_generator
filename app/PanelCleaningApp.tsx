'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,BoxSelect,CheckCircle2,Download,MousePointer2,Printer,Target,Undo2,Upload} from 'lucide-react';
import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import XYZ from 'ol/source/XYZ.js';
import Draw,{createBox} from 'ol/interaction/Draw.js';
import {intersects} from 'ol/extent.js';
import {booleanIntersects,booleanPointInPolygon,point} from '@turf/turf';
import type {Feature as GeoFeature,Polygon,MultiPolygon} from 'geojson';
import ReportEditor from '@/components/ReportEditor';
import PanelPrintableReport from '@/components/PanelPrintableReport';
import {getPanelDb,getLegacyPanelProject,panelMetrics,periods,validateProject,isISODate,type PanelProject,type CleaningRound} from '@/lib/panel-project';
import {sumTables,selectionUnits,type SelectionPrecision,type QuarterFeature,type PanelDataset} from '@/lib/panel-geometry';
import {defaultReporting,displayDate,targetWindow,type Reporting,type TargetPeriod} from '@/lib/reporting';
import {currentImageryUrl,type ReportMapResult} from '@/lib/report-map';
import {makePanelSources,panelStyle,panelDateStyle,renderPanelMap} from '@/lib/panel-map';
import {attachMapNavigation} from '@/lib/map-navigation';
import {createImagerySource} from '@/lib/imagery';

type Tool='click'|'rectangle'|'polygon';
type TableDataset={metadata:PanelDataset['metadata'];features:QuarterFeature[]};
type Imagery={id:string;label:string;url:string};
type PrintMaps={overview:ReportMapResult;latest:ReportMapResult|null;project:PanelProject};
const today=()=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const format=new GeoJSON();
const projections={dataProjection:'EPSG:4326',featureProjection:'EPSG:3857'};
const button='panel-button';

function newProject(dataset:Pick<PanelDataset,'metadata'>):PanelProject{
  const date=today(),id=crypto.randomUUID();
  const details={title:'Panel-Cleaning Progress Report',reportDate:date,preparedBy:'',team:'ZEPDI',remarks:''};
  return {id:'current',kind:'panel-cleaning',version:1,datasetId:dataset.metadata.datasetId,pitch:dataset.metadata.fullTableMeters,
    rounds:[{id,label:`Q${Math.floor((Number(date.slice(5,7))-1)/3)+1} · Round 1`,completed:{},targets:{}}],activeRoundId:id,
    reporting:defaultReporting(details),details,workDate:date,rangeStart:`${date.slice(0,4)}-01-01`,rangeEnd:date,imageryId:'current',updatedAt:new Date().toISOString()};
}

export default function PanelCleaningApp({onBack}:{onBack:()=>void}){
  const el=useRef<HTMLDivElement>(null),fileInput=useRef<HTMLInputElement>(null),mapRef=useRef<OlMap|null>(null);
  const tableSource=useRef(new VectorSource()),labelSource=useRef(new VectorSource()),tileSource=useRef<XYZ|null>(null);
  const tileLayer=useRef<TileLayer<XYZ>|null>(null),projectRef=useRef<PanelProject|null>(null),history=useRef<PanelProject[]>([]);
  const database=useRef<ReturnType<typeof getPanelDb>|null>(null);
  const [legacyProject,setLegacyProject]=useState<PanelProject|null>(null);
  const [dataset,setDataset]=useState<TableDataset|null>(null),[features,setFeatures]=useState<QuarterFeature[]>([]),[project,setProject]=useState<PanelProject|null>(null);
  const [imagery,setImagery]=useState<Imagery[]>([{id:'current',label:'Current imagery',url:currentImageryUrl}]);
  const [tool,setTool]=useState<Tool>('rectangle'),[unit,setUnit]=useState<SelectionPrecision>('table'),[contained,setContained]=useState(true);
  const [selected,setSelected]=useState<Set<string>>(new Set()),[ready,setReady]=useState(false),[status,setStatus]=useState('Loading all five blocks…');
  const [error,setError]=useState(''),[satellite,setSatellite]=useState(true),[datesVisible,setDatesVisible]=useState(true),[block,setBlock]=useState('all');
  const [imageryNotice,setImageryNotice]=useState('');
  const [printing,setPrinting]=useState(false),[printMaps,setPrintMaps]=useState<PrintMaps|null>(null),[undoCount,setUndoCount]=useState(0),[hover,setHover]=useState('');
  const validIds=useMemo(()=>new Set(features.map(f=>f.properties.id)),[features]);
  const round=project?.rounds.find(r=>r.id===project.activeRoundId);
  const period=project?targetWindow(project.reporting.targetPeriod,project.details.reportDate):null;
  const activeTarget=round&&period?round.targets[period.key]:undefined;
  const metrics=useMemo(()=>project&&round?panelMetrics(features,round,project.rangeStart,project.rangeEnd,activeTarget?.ids):null,[project,round,features,activeTarget]);
  const targetMetrics=useMemo(()=>project&&round&&period?panelMetrics(features,round,period.start,project.details.reportDate,activeTarget?.ids).total:null,[project,round,period,features,activeTarget]);
  const selectionTotal=useMemo(()=>sumTables(features.filter(f=>selected.has(f.properties.id))),[features,selected]);
  const activeImagery=imagery.find(i=>i.id===project?.imageryId)||imagery[0];
  const displayStart=project?.rangeStart||'',displayEnd=project?.rangeEnd||'';

  useEffect(()=>{
    let cancelled=false;
    async function load(){
      const response=await fetch('/panel-cleaning/tables.json');if(!response.ok)throw new Error('Panel geometry could not be loaded.');
      const data=await response.json() as TableDataset;
      let p=newProject(data),saveMessage='Ready';
      let saved:PanelProject|undefined;
      const db=getPanelDb(data.metadata.datasetId);
      try{saved=await db.projects.get('current');}catch{saveMessage='Autosave unavailable; export a backup.';}
      // A mismatched saved dataset must never be silently replaced with a blank project.
      if(saved)p=validateProject(saved,data.metadata.datasetId,new Set(data.features.map(f=>f.properties.id)),data.metadata.fullTableMeters);
      const legacy=await getLegacyPanelProject().catch(()=>undefined);
      if(cancelled)return;
      database.current=db;setLegacyProject(legacy||null);
      setDataset(data);setFeatures(data.features);projectRef.current=p;setProject(p);setStatus(saveMessage);
      const catalog=await fetch('/data/esri-wayback.json').then(r=>r.ok?r.json():null).catch(()=>null);
      if(!cancelled&&catalog)setImagery([catalog.current,...catalog.releases]);
    }
    load().catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Panel data could not be loaded.');});
    return()=>{cancelled=true;};
  },[]);

  // Save each edit directly, so returning to the menu does not discard a debounce.
  useEffect(()=>{
    if(!project)return;projectRef.current=project;let current=true;
    database.current!.projects.put(project).then(()=>{if(current)setStatus('Saved on this device');}).catch(()=>{if(current)setStatus('Autosave failed — export a backup');});
    return()=>{current=false;};
  },[project]);

  useEffect(()=>{
    if(!el.current||!features.length)return;
    const xyz=createImagerySource(currentImageryUrl);tileSource.current=xyz;
    const base=new TileLayer({source:xyz,preload:1});tileLayer.current=base;
    const map=new OlMap({target:el.current,layers:[base,new VectorLayer({source:tableSource.current,style:panelStyle}),new VectorLayer({source:labelSource.current,style:panelDateStyle,declutter:true})],view:new View({maxZoom:21})});
    mapRef.current=map;setReady(true);
    const detachNavigation=attachMapNavigation(map,el.current);
    const pointer=(e:import('ol/MapBrowserEvent.js').default<PointerEvent|KeyboardEvent|WheelEvent>)=>{
      if(e.dragging)return;let found='';map.forEachFeatureAtPixel(e.pixel,f=>{
        if(!f.get('id'))return;const date=f.get('workDate');found=`${f.get('row')} · T${f.get('table')} · quarter ${f.get('quarter')} (0.25 table)${date?` · completed ${displayDate(String(date))}`:''}${f.get('target')?' · target':''}`;return true;
      });setHover(found);
    };
    map.on('pointermove',pointer);
    return()=>{detachNavigation();map.un('pointermove',pointer);map.setTarget(undefined);map.dispose();mapRef.current=null;};
  },[features]);

  useEffect(()=>{
    if(!ready||!round||!displayStart||!displayEnd)return;
    const sources=makePanelSources(features,round,displayStart,displayEnd,activeTarget?.ids||[]);
    sources.tables.getFeatures().forEach(f=>f.set('selected',selected.has(String(f.get('id')))));
    tableSource.current.clear();tableSource.current.addFeatures(sources.tables.getFeatures());
    labelSource.current.clear();if(datesVisible)labelSource.current.addFeatures(sources.labels.getFeatures());
  },[ready,features,round,displayStart,displayEnd,activeTarget,datesVisible,selected]);

  useEffect(()=>{tableSource.current.getFeatures().forEach(f=>f.set('selected',selected.has(String(f.get('id')))));},[selected,round,ready]);
  useEffect(()=>{
    if(!ready)return;
    const source=createImagerySource(activeImagery.url,()=>{if(tileSource.current===source)setImageryNotice('Using lower-resolution imagery where detailed tiles are unavailable.');});
    source.on('tileloaderror',()=>{if(tileSource.current===source)setImageryNotice('Satellite tiles could not be loaded. Try another imagery release or check your internet connection.');});
    tileSource.current=source;tileLayer.current?.setSource(source);
  },[activeImagery.url,ready]);
  useEffect(()=>{tileLayer.current?.setVisible(satellite);},[satellite,ready]);
  useEffect(()=>{
    if(!ready)return;const visible=tableSource.current.getFeatures().filter(f=>block==='all'||f.get('block')===block);
    if(visible.length){const source=new VectorSource({features:visible});mapRef.current?.getView().fit(source.getExtent()!,{padding:[30,30,30,30],maxZoom:19});}
  },[block,ready]);

  useEffect(()=>{
    const map=mapRef.current;if(!map||!ready)return;
    if(tool==='click'){
      const click=(e:import('ol/MapBrowserEvent.js').default<PointerEvent|KeyboardEvent|WheelEvent>)=>map.forEachFeatureAtPixel(e.pixel,f=>{
        const id=String(f.get('id')||'');if(!validIds.has(id))return;
        const ids=selectionUnits(features,new Set([id]),unit);setSelected(previous=>{const next=new Set(previous);const remove=[...ids].every(x=>next.has(x));for(const x of ids){if(remove)next.delete(x);else next.add(x);}return next;});return true;
      });map.on('singleclick',click);return()=>map.un('singleclick',click);
    }
    const draw=new Draw({source:new VectorSource(),type:tool==='rectangle'?'Circle':'Polygon',geometryFunction:tool==='rectangle'?createBox():undefined});
    draw.on('drawend',event=>{
      const shape=event.feature.getGeometry()!;const geo=format.writeFeatureObject(event.feature,projections) as GeoFeature<Polygon>;
      const matched=new Set<string>();const candidates=tableSource.current.getFeatures().filter(f=>intersects(shape.getExtent(),f.getGeometry()!.getExtent()));
      for(const f of candidates){
        const quarter=format.writeFeatureObject(f,projections) as GeoFeature<Polygon|MultiPolygon>;
        const rings=quarter.geometry.type==='Polygon'?[quarter.geometry.coordinates[0]]:quarter.geometry.coordinates.map(p=>p[0]);
        if(contained?rings.every(ring=>ring.every(p=>booleanPointInPolygon(point(p),geo))):booleanIntersects(quarter,geo))matched.add(String(f.get('id')));
      }
      const ids=selectionUnits(features,matched,unit,contained);
      setSelected(previous=>new Set([...previous,...ids]));
    });map.addInteraction(draw);return()=>map.removeInteraction(draw);
  },[tool,unit,contained,features,validIds,ready]);

  function edit(update:(p:PanelProject)=>PanelProject,undo=true){
    const current=projectRef.current;if(!current)return;
    if(undo){history.current=[...history.current.slice(-39),current];setUndoCount(history.current.length);}
    const next={...update(current),updatedAt:new Date().toISOString()};projectRef.current=next;setProject(next);setPrintMaps(null);
  }
  function editRound(update:(r:CleaningRound)=>CleaningRound){edit(p=>({...p,rounds:p.rounds.map(r=>r.id===p.activeRoundId?update(r):r)}));}
  function commit(action:'target'|'completed'|'reset'|'remove-target'){
    if(!selected.size||!project||!round||!period)return;
    if(action==='completed'){
      const dated=[...selected].filter(id=>round.completed[id]&&round.completed[id]!==project.workDate);
      if(dated.length&&!window.confirm(`${dated.length/4} tables already have a completion date in this round. Replace that date with ${displayDate(project.workDate)}? Use a new round for repeat cleaning.`))return;
    }
    editRound(r=>{
      if(action==='completed'||action==='reset'){const completed={...r.completed};for(const id of selected){if(action==='completed')completed[id]=project.workDate;else delete completed[id];}return {...r,completed};}
      const existing=r.targets[period.key]||{ids:[],dueDate:period.end};const ids=new Set(existing.ids);
      for(const id of selected){if(action==='target')ids.add(id);else ids.delete(id);}
      return {...r,targets:{...r.targets,[period.key]:{...existing,ids:[...ids]}}};
    });setSelected(new Set());
  }
  function backup(value=projectRef.current,previous=false){if(!value)return;const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`Armenia-panel-cleaning${previous?'_previous-dataset':''}_${value.details.reportDate}.json`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function importBackup(file:File){
    try{
      if(file.size>40*1024*1024)throw new Error('Choose a backup smaller than 40 MB.');
      const restored=validateProject(JSON.parse(await file.text()),dataset!.metadata.datasetId,validIds,dataset!.metadata.fullTableMeters);
      if(!window.confirm('Replace the current panel-cleaning project with this backup? The current state remains available through Undo.'))return;
      edit(()=>restored);setSelected(new Set());setError('');
    }catch(e){setError(e instanceof Error?e.message:'The backup could not be imported.');}
  }
  async function printReport(){
    if(!project||!round||printing)return;setPrinting(true);setError('');
    try{
      const dates=Object.values(round.completed).filter(d=>d>=project.rangeStart&&d<=project.rangeEnd).sort();const latestDate=dates.at(-1);
      const focus=latestDate?new Set(features.filter(f=>round.completed[f.properties.id]===latestDate).map(f=>f.properties.id)):undefined;
      const overview=await renderPanelMap(features,round,project.rangeStart,project.rangeEnd,activeTarget?.ids||[],activeImagery.url,satellite);
      const latest=focus?.size?await renderPanelMap(features,round,project.rangeStart,project.rangeEnd,activeTarget?.ids||[],activeImagery.url,satellite,focus):null;
      setPrintMaps({overview,latest,project});
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      await document.fonts.ready;await Promise.all([...document.querySelectorAll<HTMLImageElement>('.print-report img')].map(img=>img.decode().catch(()=>undefined)));
      window.print();
    }catch(e){setError(e instanceof Error?e.message:'Report export failed.');}finally{setPrinting(false);}
  }
  const setReporting:React.Dispatch<React.SetStateAction<Reporting>>=value=>edit(p=>({...p,reporting:typeof value==='function'?value(p.reporting):value}));
  const changeDate=(key:'workDate'|'rangeStart'|'rangeEnd',date:string)=>{if(!isISODate(date))return;edit(p=>({...p,[key]:date,...(key==='rangeStart'&&date>p.rangeEnd?{rangeEnd:date}:key==='rangeEnd'&&date<p.rangeStart?{rangeStart:date}:{})}),false);};

  if(!project||!dataset||!round||!metrics||!targetMetrics||!period)return <main className="loading-screen"><p>{error||status}</p><button className={button} onClick={onBack}>← Reports</button></main>;
  const completedDates=[...new Set(Object.values(round.completed))].sort().reverse();
  return <>
    <main className="panel-app screen-only">
      <header className="panel-header"><button className={button} onClick={async()=>{await database.current!.projects.put(projectRef.current!).catch(()=>undefined);onBack();}}><ArrowLeft size={16}/>Reports</button><div><h1>Panel Cleaning Report</h1><p>Armenia Solar · all five blocks · 0.25-table precision</p></div><div className="panel-actions"><span role="status">{status}</span><button className={button} disabled={!undoCount||printing} onClick={()=>{const previous=history.current.pop();if(previous){projectRef.current=previous;setProject(previous);setUndoCount(history.current.length);setPrintMaps(null);setSelected(new Set());}}}><Undo2 size={16}/>Undo</button><button className={button} onClick={()=>backup()}><Download size={16}/>Backup</button><button className={button} onClick={()=>fileInput.current?.click()}><Upload size={16}/>Import</button><button className={`${button} primary`} onClick={printReport} disabled={printing||!ready}><Printer size={16}/>{printing?'Preparing…':'Export PDF'}</button><input hidden ref={fileInput} type="file" accept="application/json,.json" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void importBackup(file);}}/></div></header>
      {error&&<div className="panel-error" role="alert">{error}<button onClick={()=>setError('')}>Dismiss</button></div>}
      {legacyProject&&<div className="panel-error" role="status">The previous table calibration has changed. This dataset has separate saved progress; your previous project is preserved.<button className={button} onClick={()=>backup(legacyProject,true)}>Export previous panel backup</button></div>}
      <div className="panel-summary"><div><span>Verified plant total</span><strong>{metrics.total.tables.toFixed(2)} tables</strong><small>{metrics.total.rows} traced rows</small></div><div><span>Completed in date range</span><strong>{metrics.total.completed.toFixed(2)} tables</strong><small>{metrics.total.pct.toFixed(1)}% of plant</small></div><div><span>{project.reporting.targetPeriod} target</span><strong>{targetMetrics.target.toFixed(2)} tables</strong><small>{targetMetrics.targetCompleted.toFixed(2)} completed inside target</small></div><div><span>Temporary selection</span><strong>{selectionTotal.toFixed(2)} tables</strong><small>{selected.size} quarter sections</small></div></div>
      <div className="panel-workspace">
        <section className="panel-map-section"><div className="panel-toolbar"><button className={`${button} ${tool==='click'?'active':''}`} onClick={()=>setTool('click')}><MousePointer2 size={16}/>Click</button><button className={`${button} ${tool==='rectangle'?'active':''}`} onClick={()=>setTool('rectangle')}><BoxSelect size={16}/>Rectangle</button><button className={`${button} ${tool==='polygon'?'active':''}`} onClick={()=>setTool('polygon')}>Polygon</button><select aria-label="Selection precision" value={unit} onChange={e=>setUnit(e.target.value as typeof unit)}><option value="table">Whole tables</option><option value="half">Half tables (0.50)</option><option value="quarter">Quarter tables (0.25)</option></select><label><input type="checkbox" checked={contained} onChange={e=>setContained(e.target.checked)}/>Fully enclosed</label><select aria-label="Zoom to block" value={block} onChange={e=>setBlock(e.target.value)}><option value="all">All blocks</option>{dataset.metadata.blocks.map(b=><option key={b.block}>{b.block}</option>)}</select><button className={button} onClick={()=>setSelected(new Set())}>Clear selection</button></div>
          <div ref={el} className="panel-map" tabIndex={0} role="region" aria-label="Panel-cleaning map. Use W A S D to pan."/><div className="panel-hover">{hover||'Draw a rectangle to select enclosed tables. Choose quarter precision for partial completion. Hover over or focus the map, then hold W A S D to pan.'}</div>
          <div className="panel-imagery"><label><input type="checkbox" checked={satellite} onChange={e=>setSatellite(e.target.checked)}/>Satellite</label><select aria-label="Imagery release" value={project.imageryId} onChange={e=>{setImageryNotice('');edit(p=>({...p,imageryId:e.target.value}),false);}}>{imagery.map(i=><option key={i.id} value={i.id}>{i.label}</option>)}</select><label><input type="checkbox" checked={datesVisible} onChange={e=>setDatesVisible(e.target.checked)}/>Date labels</label><small>Archive dates identify releases, not capture dates.</small></div>
          <div className="panel-commit"><button className={`${button} target`} disabled={!selected.size||printing} onClick={()=>commit('target')}><Target size={16}/>Set as Target</button><button className={`${button} completed`} disabled={!selected.size||printing} onClick={()=>commit('completed')}><CheckCircle2 size={16}/>Mark Completed</button><button className={button} disabled={!selected.size||printing} onClick={()=>commit('remove-target')}>Remove target</button><button className={button} disabled={!selected.size||printing} onClick={()=>commit('reset')}>Clear completion</button><span>Yellow = selected · blue = target · green = completed</span></div>
          <table className="panel-block-table"><thead><tr><th>Block</th><th>Rows</th><th>Total tables</th><th>Target</th><th>Completed</th><th>Progress</th></tr></thead><tbody>{[...metrics.blocks,metrics.total].map(b=><tr key={b.id}><th>{b.id}</th><td>{b.rows}</td><td>{b.tables.toFixed(2)}</td><td>{b.target.toFixed(2)}</td><td>{b.completed.toFixed(2)}</td><td>{b.pct.toFixed(1)}%</td></tr>)}</tbody></table>
          {satellite&&imageryNotice&&<p className="map-imagery-notice" role="status">{imageryNotice}</p>}
          <p className="panel-calibration">Calibrated at {project.pitch} m per actual table; all five block totals match the supplied counts. Verify individual boundaries on satellite imagery. {dataset.metadata.warnings.join(' ')}</p>
        </section>
        <aside className="panel-sidebar">
          <section className="panel-section report-settings"><h2>Cleaning round & dates</h2><label>Active cleaning round<select value={round.id} onChange={e=>{setSelected(new Set());edit(p=>({...p,activeRoundId:e.target.value}),false);}}>{project.rounds.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label><label>Round label<input value={round.label} onChange={e=>editRound(r=>({...r,label:e.target.value}))}/></label><button className={button} onClick={()=>{const label=window.prompt('New cleaning round name',`Round ${project.rounds.length+1}`);if(!label?.trim())return;const id=crypto.randomUUID();setSelected(new Set());edit(p=>({...p,rounds:[...p.rounds,{id,label:label.trim(),completed:{},targets:{}}],activeRoundId:id}));}}>New cleaning round</button><p className="field-help">Earlier rounds remain saved. Repeat cleaning belongs in a new round.</p><label>Work date<input type="date" value={project.workDate} onChange={e=>changeDate('workDate',e.target.value)}/></label><label>Report coverage from<input type="date" value={project.rangeStart} onChange={e=>changeDate('rangeStart',e.target.value)}/></label><label>Report coverage through<input type="date" value={project.rangeEnd} onChange={e=>changeDate('rangeEnd',e.target.value)}/></label><p className="field-help">Mark Completed records the work date. Visible progress and PDF totals use the coverage range.</p></section>
          <section className="panel-section report-settings"><h2>Report planning</h2><label>Report title<input value={project.details.title} onChange={e=>edit(p=>({...p,details:{...p.details,title:e.target.value}}),false)}/></label><label>Report date<input type="date" value={project.details.reportDate} onChange={e=>{const date=e.target.value;if(isISODate(date))edit(p=>({...p,details:{...p.details,reportDate:date}}),false);}}/></label><label>Contractor / team<input value={project.details.team} onChange={e=>edit(p=>({...p,details:{...p.details,team:e.target.value}}),false)}/></label><label>Target period<select value={project.reporting.targetPeriod} onChange={e=>edit(p=>({...p,reporting:{...p.reporting,targetPeriod:e.target.value as TargetPeriod}}),false)}>{periods.map(p=><option key={p} value={p}>{p}</option>)}</select></label><p className="field-help">{displayDate(period.start)}–{displayDate(period.end)} · use Set as Target on the selected table geometry.</p><label>Target completion date<input type="date" value={activeTarget?.dueDate||period.end} onChange={e=>{const date=e.target.value;if(isISODate(date))editRound(r=>({...r,targets:{...r.targets,[period.key]:{ids:activeTarget?.ids||[],dueDate:date}}}));}}/></label><div className="target-feedback"><strong>{targetMetrics.targetCompleted.toFixed(2)} / {targetMetrics.target.toFixed(2)} target tables</strong><span>{targetMetrics.target?`${(targetMetrics.targetCompleted/targetMetrics.target*100).toFixed(1)}% achieved`:'Select target tables on the map'}</span><span>Only completed tables inside the target and period count toward achievement.</span></div><label>Remarks<textarea rows={3} value={project.details.remarks} onChange={e=>edit(p=>({...p,details:{...p.details,remarks:e.target.value}}),false)}/></label></section>
          <ReportEditor value={project.reporting} onChange={setReporting} reportDate={project.details.reportDate} actualHa={0} hasTargetGeometry={false} hidePlanning onError={setError}/>
          <section className="panel-section report-settings"><h2>Dated completion history</h2>{completedDates.length?completedDates.map(date=><div className="panel-history" key={date}><span>{displayDate(date)}</span><strong>{(Object.values(round.completed).filter(d=>d===date).length/4).toFixed(2)} tables</strong></div>):<p>No completed tables in this round.</p>}</section>
        </aside>
      </div>
    </main>
    {printMaps&&<PanelPrintableReport project={printMaps.project} round={printMaps.project.rounds.find(r=>r.id===printMaps.project.activeRoundId)!} features={features} overview={printMaps.overview} latest={printMaps.latest} imageryLabel={activeImagery.label}/>}
  </>;
}
