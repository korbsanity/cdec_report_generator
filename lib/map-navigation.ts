import type OlMap from 'ol/Map.js';

const directions:Record<string,[number,number]>={w:[0,1],a:[-1,0],s:[0,-1],d:[1,0]};
const editableSelector='input,textarea,select,button,[role="textbox"],[role="combobox"],[contenteditable]:not([contenteditable="false"])';

export function isMapShortcutBlocked(target:EventTarget|null):boolean {
  const element=target as Element|null;
  return typeof element?.closest==='function' && !!element.closest(editableSelector);
}

// Screen-relative movement, independent of zoom, frame rate, or diagonal keys.
export function keyboardPanDelta(keys:Set<string>,resolution:number,rotation:number,elapsedMs:number):[number,number] {
  let x=0,y=0;
  for(const key of keys){const delta=directions[key];if(delta){x+=delta[0];y+=delta[1];}}
  const norm=Math.hypot(x,y);
  if(!norm)return [0,0];
  const distance=480*resolution*Math.min(64,Math.max(0,elapsedMs))/1000;
  x=x/norm*distance;y=y/norm*distance;
  return [x*Math.cos(rotation)-y*Math.sin(rotation),x*Math.sin(rotation)+y*Math.cos(rotation)];
}

export function attachMapNavigation(map:OlMap,target:HTMLElement):()=>void {
  const keys=new Set<string>();let hovered=false,frame=0,lastTime=0;
  const stop=()=>{keys.clear();cancelAnimationFrame(frame);frame=0;};
  const tick=(time:number)=>{
    if(!keys.size){frame=0;return;}
    const view=map.getView(),resolution=view.getResolution();
    if(resolution!==undefined)view.adjustCenter(keyboardPanDelta(keys,resolution,view.getRotation(),time-lastTime));
    lastTime=time;frame=requestAnimationFrame(tick);
  };
  const keydown=(event:KeyboardEvent)=>{
    const key=event.key.toLowerCase();
    if(!(key in directions)||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.isComposing||isMapShortcutBlocked(event.target))return;
    if(!hovered&&!target.contains(document.activeElement))return;
    event.preventDefault();keys.add(key);
    if(!frame){map.getView().cancelAnimations();lastTime=performance.now();frame=requestAnimationFrame(tick);}
  };
  const keyup=(event:KeyboardEvent)=>{keys.delete(event.key.toLowerCase());if(!keys.size)stop();};
  const enter=()=>{hovered=true;};
  const leave=()=>{hovered=false;stop();};
  const focus=(event:PointerEvent)=>{if(!isMapShortcutBlocked(event.target))target.focus({preventScroll:true});};
  const focusOut=(event:FocusEvent)=>{if(!target.contains(event.relatedTarget as Node|null))stop();};
  const visibility=()=>{if(document.hidden)stop();};
  target.addEventListener('pointerenter',enter);target.addEventListener('pointerleave',leave);
  target.addEventListener('pointerdown',focus);target.addEventListener('focusout',focusOut);
  window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);
  window.addEventListener('blur',stop);document.addEventListener('visibilitychange',visibility);
  return ()=>{
    stop();target.removeEventListener('pointerenter',enter);target.removeEventListener('pointerleave',leave);
    target.removeEventListener('pointerdown',focus);target.removeEventListener('focusout',focusOut);
    window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);
    window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',visibility);
  };
}
