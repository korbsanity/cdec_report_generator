import assert from 'node:assert/strict';
import test from 'node:test';
import TileState from 'ol/TileState.js';
import {get as projection} from 'ol/proj.js';
import {keyboardPanDelta,isMapShortcutBlocked,attachMapNavigation} from '../lib/map-navigation.ts';
import {createImagerySource,MAX_IMAGERY_ZOOM,imageryTileUrl,parentTileCrop,resolveImageryTile} from '../lib/imagery.ts';

test('WASD pans in screen directions at consistent speed, zoom, and diagonal movement',()=>{
 assert.deepEqual(keyboardPanDelta(new Set(['w']),2,0,50),[0,48]);
 assert.deepEqual(keyboardPanDelta(new Set(['s']),2,0,50),[0,-48]);
 assert.deepEqual(keyboardPanDelta(new Set(['a']),2,0,50),[-48,0]);
 assert.deepEqual(keyboardPanDelta(new Set(['d']),2,0,50),[48,0]);
 assert.deepEqual(keyboardPanDelta(new Set(['w','s']),2,0,50),[0,0]);
 const diagonal=keyboardPanDelta(new Set(['w','d']),2,0,50);
 assert.ok(Math.abs(Math.hypot(...diagonal)-48)<1e-10);
 const rotated=keyboardPanDelta(new Set(['w']),1,Math.PI/2,50);
 assert.ok(Math.abs(rotated[0]+24)<1e-10&&Math.abs(rotated[1])<1e-10);
 assert.equal(keyboardPanDelta(new Set(['w']),1,0,10000)[1],30.72);
 assert.equal(isMapShortcutBlocked({closest:()=>({})}),true);
 assert.equal(isMapShortcutBlocked({closest:()=>null}),false);
});

test('keyboard events require map scope, ignore fields/modifiers, and stop on release, blur, and disposal',()=>{
 const originals=new Map(['window','document','requestAnimationFrame','cancelAnimationFrame'].map(k=>[k,globalThis[k]]));
 const target=new EventTarget(),win=new EventTarget(),doc=new EventTarget();
 const frames=new Map();let counter=0,moves=0;
 target.contains=node=>node===target;target.focus=()=>{doc.activeElement=target;};
 doc.activeElement=null;doc.hidden=false;
 const view={getResolution:()=>1,getRotation:()=>0,adjustCenter:()=>{moves++;},cancelAnimations:()=>{}};
 globalThis.window=win;globalThis.document=doc;
 globalThis.requestAnimationFrame=cb=>{frames.set(++counter,cb);return counter;};
 globalThis.cancelAnimationFrame=id=>frames.delete(id);
 let detach;
 const key=(type,letter,options={})=>{
  const e=new Event(type,{cancelable:true});Object.assign(e,{key:letter,ctrlKey:false,metaKey:false,altKey:false,isComposing:false,...options});win.dispatchEvent(e);return e;
 };
 try{
  detach=attachMapNavigation({getView:()=>view},target);
  assert.equal(key('keydown','w').defaultPrevented,false);assert.equal(frames.size,0);
  target.dispatchEvent(new Event('pointerenter'));
  assert.equal(key('keydown','W').defaultPrevented,true);
  const [id,cb]=frames.entries().next().value;frames.delete(id);cb(performance.now()+16);
  assert.equal(moves,1);key('keyup','W');assert.equal(frames.size,0);
  key('keydown','a',{ctrlKey:true});assert.equal(frames.size,0);
  key('keydown','a',{isComposing:true});assert.equal(frames.size,0);
  win.closest=()=>({});key('keydown','s');assert.equal(frames.size,0);delete win.closest;
  key('keydown','d');win.dispatchEvent(new Event('blur'));assert.equal(frames.size,0);
  key('keydown','w');target.dispatchEvent(new Event('pointerleave'));assert.equal(frames.size,0);
  doc.activeElement=target;key('keydown','a');assert.equal(frames.size,1);
  detach();detach=null;assert.equal(frames.size,0);
  assert.equal(key('keydown','w').defaultPrevented,false);
 }finally{detach?.();for(const [key,value] of originals){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('imagery uses a bounded native zoom and suppresses provider blank tiles',()=>{
 const template='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
 const source=createImagerySource(template);
 assert.equal(MAX_IMAGERY_ZOOM,18);assert.equal(source.getTileGrid().getMaxZoom(),18);
 assert.equal(imageryTileUrl(template,[18,101,205]),'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/205/101?blankTile=false');
 source.dispose();
});

test('missing imagery uses the correct containing parent and preserves its historical release',async()=>{
 const calls=[],template='https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/GoogleMapsCompatible/MapServer/tile/26334/{z}/{y}/{x}';
 const resolved=await resolveImageryTile([18,101,205],async coord=>{
  calls.push(coord);assert.ok(imageryTileUrl(template,coord).includes('/tile/26334/'));
  if(coord[0]>16)throw new Error('404');return 'parent image';
 });
 assert.deepEqual(calls,[[18,101,205],[17,50,102],[16,25,51]]);
 assert.deepEqual(resolved,{image:'parent image',coordinate:[16,25,51]});
 assert.deepEqual(parentTileCrop([18,101,205],[16,25,51],256,256),[64,64,64,64]);
 assert.deepEqual(parentTileCrop([18,102,204],[17,51,102],256,256),[0,0,128,128]);
 let failures=0;await assert.rejects(()=>resolveImageryTile([18,101,205],async()=>{failures++;throw new Error('offline');}),/unavailable/);
 assert.equal(failures,5);
});

test('OpenLayers loader draws fallback tiles, shares parent loads, and finishes loaded',async()=>{
 const originals=new Map(['window','document','Image'].map(k=>[k,globalThis[k]]));
 const requests=[],draws=[];let fallbacks=0;
 class FakeImage extends EventTarget{
  naturalWidth=256;naturalHeight=256;
  set src(address){
   this.address=address;if(!address)return;requests.push(address);
   queueMicrotask(()=>{if(address.includes('/tile/18/'))this.onerror?.();else this.onload?.();});
  }
  get src(){return this.address||'';}
 }
 globalThis.Image=FakeImage;globalThis.window={setTimeout,clearTimeout};
 globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage:(...args)=>draws.push(args)})})};
 let source;
 try{
  source=createImagerySource('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',()=>{fallbacks++;});
  for(const coordinate of [[18,101,205],[18,100,204]]){
   const tile=source.getTile(...coordinate,1,projection('EPSG:3857'));
   const loaded=new Promise((resolve,reject)=>tile.addEventListener('change',()=>{if(tile.getState()===TileState.LOADED)resolve();if(tile.getState()===TileState.ERROR)reject(new Error('tile failed'));}));
   tile.load();await loaded;
   assert.equal(tile.getImage().width,256);
  }
  assert.equal(fallbacks,2);assert.equal(draws.length,2);
  assert.deepEqual(draws[0].slice(1),[128,128,128,128,0,0,256,256]);
  assert.equal(requests.filter(url=>url.includes('/tile/17/')).length,1);
 }finally{source?.dispose();for(const [key,value] of originals){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
