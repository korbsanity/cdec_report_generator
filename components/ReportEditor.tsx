'use client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import type { Reporting, SignRole, TargetPeriod } from '@/lib/reporting';
import { displayDate, targetWindow } from '@/lib/reporting';

/* eslint-disable @next/next/no-img-element -- local previews use generated data URLs. */

// Uploads are kept inside the portable project; no remote image service is used.
async function readImage(file:File, signature:boolean):Promise<string> {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG or WebP image.');
  if(file.size>15*1024*1024)throw new Error('Choose an image smaller than 15 MB.');
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();image.src=url;await image.decode();
    const scale=Math.min(1,(signature?1000:1600)/Math.max(image.width,image.height));
    const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
    canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);
    return canvas.toDataURL(signature?'image/png':'image/jpeg',0.86);
  } finally {URL.revokeObjectURL(url);}
}

function ImageField({label,value,signature=false,onChange,onError}:{label:string;value:string;signature?:boolean;onChange:(value:string)=>void;onError:(message:string)=>void}) {
  return <div className="image-field">
    <label>{label}<Input aria-label={label} type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{
      const file=e.target.files?.[0];e.target.value='';if(!file)return;
      try {onChange(await readImage(file,signature));}catch(error){onError(error instanceof Error?error.message:'Image could not be opened.');}
    }}/></label>
    {value&&<div className="image-preview"><img src={value} alt={label}/><Button variant="outline" size="sm" onClick={()=>onChange('')}>Remove {label.toLowerCase()}</Button></div>}
  </div>;
}

export default function ReportEditor({value,onChange,reportDate,actualHa,hasTargetGeometry,onError,hidePlanning=false}:{value:Reporting;onChange:React.Dispatch<React.SetStateAction<Reporting>>;reportDate:string;actualHa:number;hasTargetGeometry:boolean;onError:(message:string)=>void;hidePlanning?:boolean}) {
  const period=targetWindow(value.targetPeriod,reportDate);
  const target=value.targets[period.key] || {areaHa:null,dueDate:period.end,geometry:null};
  const updatePerson=(role:SignRole,key:'name'|'position'|'signature',text:string)=>onChange(previous=>({...previous,signatories:{...previous.signatories,[role]:{...previous.signatories[role],[key]:text}}}));
  const updatePhoto=(index:number,key:'before'|'after'|'caption',text:string)=>onChange(previous=>({...previous,photos:previous.photos.map((p,i)=>i===index?{...p,[key]:text}:p)}));
  return <>
    {!hidePlanning&&<section className="panel-section report-settings">
      <div className="section-heading"><div><span className="section-kicker">Report planning</span><h2>Round & target</h2></div></div>
      <label>Quarter / round<Input value={value.quarterRound} placeholder="Q3 · Round 1" onChange={e=>onChange(previous=>({...previous,quarterRound:e.target.value}))}/></label>
      <label>Target period shown on report<NativeSelect value={value.targetPeriod} onChange={e=>onChange(previous=>({...previous,targetPeriod:e.target.value as TargetPeriod}))}>
        {['daily','weekly','monthly','quarterly'].map(p=><NativeSelectOption key={p} value={p}>{p[0].toUpperCase()+p.slice(1)}</NativeSelectOption>)}
      </NativeSelect></label>
      <p className="field-help">{displayDate(period.start)}–{displayDate(period.end)} · based on report date. Weeks run Monday–Sunday. Each period keeps its own target area.</p>
      <label>Target area (weighted ha)<Input type="number" min="0" step="0.001" value={target.areaHa??''} placeholder="e.g. 0.500" readOnly={hasTargetGeometry} onChange={e=>{
        const areaHa=e.target.value===''?null:Number(e.target.value);
        if(areaHa!==null&&(!Number.isFinite(areaHa)||areaHa<0))return;
        onChange(previous=>({...previous,targets:{...previous.targets,[period.key]:{...target,areaHa}}}));
      }}/></label>
      <p className="field-help">{hasTargetGeometry?'Calculated from the target drawn on the map using the same area weights. Clear the target map to enter a manual value.':'Choose “Target area” above the map, then use Paint, Rectangle, or Polygon to draw the target. You can also enter a value manually.'}</p>
      <label>Target completion date<Input type="date" value={target.dueDate} onChange={e=>onChange(previous=>({...previous,targets:{...previous.targets,[period.key]:{...target,dueDate:e.target.value}}}))}/></label>
      <div className="target-feedback"><strong>{actualHa.toFixed(3)} ha completed</strong><span>In target period, through {displayDate(reportDate)}</span>
        {target.areaHa!=null&&target.areaHa>0?<><Progress value={Math.min(100,actualHa/target.areaHa*100)}/><span>{(actualHa/target.areaHa*100).toFixed(1)}% of target · {Math.max(0,target.areaHa-actualHa).toFixed(3)} ha remaining</span></>:<span>Enter a target to calculate achievement.</span>}
      </div>
    </section>}
    <section className="panel-section report-settings">
      <div className="section-heading"><div><span className="section-kicker">Report attachments</span><h2>Before & after</h2></div></div>
      <p className="field-help">Up to two pairs. Photos and signatures are saved locally and included in exported history.</p>
      {value.photos.map((pair,i)=><fieldset key={i}><legend>Photo pair {i+1}</legend>
        <ImageField label={`Before ${i+1}`} value={pair.before} onChange={text=>updatePhoto(i,'before',text)} onError={onError}/>
        <ImageField label={`After ${i+1}`} value={pair.after} onChange={text=>updatePhoto(i,'after',text)} onError={onError}/>
        <label>Pair {i+1} location / caption<Input value={pair.caption} onChange={e=>updatePhoto(i,'caption',e.target.value)}/></label>
      </fieldset>)}
    </section>
    <section className="panel-section report-settings">
      <div className="section-heading"><div><span className="section-kicker">Sign-off</span><h2>Names & signatures</h2></div></div>
      {(['prepared','checked','approved'] as const).map(role=><fieldset key={role}><legend>{role[0].toUpperCase()+role.slice(1)} by</legend>
        <label>{role[0].toUpperCase()+role.slice(1)} by<Input value={value.signatories[role].name} onChange={e=>updatePerson(role,'name',e.target.value)}/></label>
        <label>Position / designation<Input aria-label={`${role} position`} value={value.signatories[role].position} onChange={e=>updatePerson(role,'position',e.target.value)}/></label>
        <ImageField label={`${role[0].toUpperCase()+role.slice(1)} signature`} value={value.signatories[role].signature} signature onChange={text=>updatePerson(role,'signature',text)} onError={onError}/>
      </fieldset>)}
    </section>
  </>;
}
