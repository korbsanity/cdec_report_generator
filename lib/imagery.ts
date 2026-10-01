import XYZ from 'ol/source/XYZ.js';
import type ImageTile from 'ol/ImageTile.js';
import TileState from 'ol/TileState.js';

export const imageryAttribution='Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';
export const currentImageryUrl='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// View zoom may exceed this: enlarge available imagery instead of requesting
// sparsely populated level 19/20 caches. Vector geometry keeps its precision.
export const MAX_IMAGERY_ZOOM=18;
type Coordinate=[number,number,number]; // z, x, y (OpenLayers ordering)

export function imageryTileUrl(template:string,[z,x,y]:Coordinate):string {
  const url=new URL(template.replace('{z}',String(z)).replace('{x}',String(x)).replace('{y}',String(y)));
  // REST services return a 404 instead of the gray "data not available" tile.
  url.searchParams.set('blankTile','false');return url.href;
}

export function parentTileCrop(target:Coordinate,parent:Coordinate,width:number,height:number):[number,number,number,number] {
  const scale=2**(target[0]-parent[0]);
  return [(target[1]-parent[1]*scale)*width/scale,(target[2]-parent[2]*scale)*height/scale,width/scale,height/scale];
}

// Stay in the selected imagery release when falling back. Never substitute
// current imagery for a historical image without the user's knowledge.
export async function resolveImageryTile<T>(target:Coordinate,load:(coordinate:Coordinate)=>Promise<T>):Promise<{image:T;coordinate:Coordinate}> {
  for(let z=target[0];z>=Math.max(0,target[0]-4);z--){
    const scale=2**(target[0]-z),coordinate:Coordinate=[z,Math.floor(target[1]/scale),Math.floor(target[2]/scale)];
    try{return {image:await load(coordinate),coordinate};}catch{/* Try its containing parent tile. */}
  }
  throw new Error('Satellite imagery is unavailable at this location.');
}

export function createImagerySource(url:string,onFallback?:()=>void):XYZ {
  // Share parent image requests between neighboring tiles; bound memory use.
  const images=new Map<string,{pending:Promise<HTMLImageElement>;expires:number}>();
  const load=(coordinate:Coordinate)=>{
    const address=imageryTileUrl(url,coordinate);
    let entry=images.get(address);
    if(!entry||entry.expires<Date.now()){
      const pending=new Promise<HTMLImageElement>((resolve,reject)=>{
        const image=new Image();image.crossOrigin='anonymous';
        const timer=window.setTimeout(()=>{image.onload=null;image.onerror=null;image.src='';reject(new Error('Imagery request timed out.'));},4000);
        image.onload=()=>{window.clearTimeout(timer);image.onload=null;image.onerror=null;resolve(image);};
        image.onerror=()=>{window.clearTimeout(timer);image.onload=null;image.onerror=null;reject(new Error('Missing imagery tile.'));};
        image.src=address;
      });
      entry={pending,expires:Infinity};images.set(address,entry);
      // Briefly cache a missing tile; allow recovery after a network outage.
      const created=entry;void pending.catch(()=>{created.expires=Date.now()+5000;});
      if(images.size>256)images.delete(images.keys().next().value!);
    }
    return entry.pending;
  };
  return new XYZ({url,maxZoom:MAX_IMAGERY_ZOOM,crossOrigin:'anonymous',attributions:imageryAttribution,interpolate:true,transition:0,
    tileLoadFunction:(tile)=>{
      const imageTile=tile as ImageTile,target=imageTile.getTileCoord() as Coordinate;
      void resolveImageryTile(target,load).then(({image,coordinate})=>{
        if(coordinate[0]===target[0]){imageTile.setImage(image);return;}
        const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
        const context=canvas.getContext('2d');if(!context)throw new Error('Cannot render imagery fallback.');
        context.imageSmoothingEnabled=true;
        context.drawImage(image,...parentTileCrop(target,coordinate,image.naturalWidth,image.naturalHeight),0,0,256,256);
        imageTile.setImage(canvas);onFallback?.();
      }).catch(()=>imageTile.setState(TileState.ERROR));
    },
  });
}
