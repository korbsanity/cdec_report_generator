import Dexie, { type EntityTable } from 'dexie';
import type { ReportDetails } from './db';
import { normalizeReporting, type Reporting, type TargetPeriod } from './reporting';
import type { QuarterFeature } from './panel-geometry';

export interface CleaningTarget { ids: string[]; dueDate: string }
export interface CleaningRound { id: string; label: string; completed: Record<string,string>; targets: Record<string,CleaningTarget> }
export interface PanelProject {
  id: 'current'; version: 1; kind: 'panel-cleaning'; datasetId: string; pitch: number;
  rounds: CleaningRound[]; activeRoundId: string; reporting: Reporting; details: ReportDetails;
  workDate: string; rangeStart: string; rangeEnd: string; imageryId: string; updatedAt: string;
}
type PanelDb = Dexie & {projects:EntityTable<PanelProject,'id'>};
const databases = new Map<string,PanelDb>();
export const panelDatabaseName=(datasetId:string)=>`armenia-panel-cleaning-${datasetId}`;
export function getPanelDb(datasetId:string):PanelDb {
  const name=panelDatabaseName(datasetId);
  let db=databases.get(name);
  if(!db){db=new Dexie(name) as PanelDb;db.version(1).stores({projects:'id, updatedAt'});databases.set(name,db);}
  return db;
}
// Read the old app's project without altering its geometry or saved history.
export async function getLegacyPanelProject():Promise<PanelProject|undefined> {
  if(!await Dexie.exists('armenia-panel-cleaning'))return undefined;
  const db=new Dexie('armenia-panel-cleaning') as PanelDb;
  db.version(1).stores({projects:'id, updatedAt'});
  try{return await db.projects.get('current');}finally{db.close();}
}
export const isISODate=(value:unknown):value is string=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
};

export function validateProject(raw:unknown, datasetId:string, validIds:Set<string>, pitch:number):PanelProject {
  if (!raw || typeof raw!=='object') throw new Error('Invalid project file.');
  const p=raw as PanelProject;
  if(p.kind!=='panel-cleaning'||p.version!==1)throw new Error('Choose a panel-cleaning v1 backup.');
  if(p.datasetId!==datasetId || p.pitch!==pitch)throw new Error('Backup geometry or calibration differs from this dataset. Keep that backup and use its matching app package.');
  if(!Array.isArray(p.rounds)||!p.rounds.length || !p.rounds.some(r=>r.id===p.activeRoundId))throw new Error('Backup has no valid active round.');
  if(!isISODate(p.workDate)||!isISODate(p.rangeStart)||!isISODate(p.rangeEnd)||p.rangeStart>p.rangeEnd||!isISODate(p.details?.reportDate))throw new Error('Backup contains invalid dates.');
  if(new Set(p.rounds.map(r=>r.id)).size!==p.rounds.length)throw new Error('Duplicate round IDs.');
  for(const round of p.rounds) {
    if(typeof round.id!=='string'||typeof round.label!=='string'||!round.completed||!round.targets)throw new Error('Invalid cleaning round.');
    for(const [id,date] of Object.entries(round.completed))if(!validIds.has(id)||!isISODate(date))throw new Error('Backup contains an unknown table or invalid completion date.');
    for(const [key,target] of Object.entries(round.targets)) {
      if(!/^(daily|weekly|monthly|quarterly):\d{4}-\d{2}-\d{2}$/.test(key)||!Array.isArray(target.ids)||!isISODate(target.dueDate)||target.ids.some(id=>!validIds.has(id)))throw new Error('Invalid target in backup.');
      target.ids=[...new Set(target.ids)];
    }
  }
  return {...p,id:'current',details:{title:String(p.details.title||'Panel-Cleaning Progress Report'),reportDate:p.details.reportDate,
    preparedBy:String(p.details.preparedBy||''),team:String(p.details.team||''),remarks:String(p.details.remarks||'')},
    reporting:normalizeReporting(p.reporting,p.details)};
}

export function panelMetrics(features:QuarterFeature[], round:CleaningRound, start:string, end:string, targetIds:string[]=[]){
  const target=new Set(targetIds), groups=new Map<string,{id:string;rows:Set<string>;tables:number;target:number;completed:number;targetCompleted:number}>();
  for(const f of features){
    const p=f.properties;
    if(!groups.has(p.block))groups.set(p.block,{id:p.block,rows:new Set(),tables:0,target:0,completed:0,targetCompleted:0});
    const b=groups.get(p.block)!;b.rows.add(p.rowId);b.tables+=p.weight;
    if(target.has(p.id))b.target+=p.weight;
    const date=round.completed[p.id];if(date && date>=start && date<=end){b.completed+=p.weight;if(target.has(p.id))b.targetCompleted+=p.weight;}
  }
  const blocks=[...groups.values()].map(b=>({...b,rows:b.rows.size,pct:b.tables?b.completed/b.tables*100:0}));
  const total=blocks.reduce((s,b)=>({id:'TOTAL',rows:s.rows+b.rows,tables:s.tables+b.tables,target:s.target+b.target,completed:s.completed+b.completed,targetCompleted:s.targetCompleted+b.targetCompleted,pct:0}),{id:'TOTAL',rows:0,tables:0,target:0,completed:0,targetCompleted:0,pct:0});
  total.pct=total.tables?total.completed/total.tables*100:0;
  return {blocks,total};
}

export const periods:TargetPeriod[]=['daily','weekly','monthly','quarterly'];
