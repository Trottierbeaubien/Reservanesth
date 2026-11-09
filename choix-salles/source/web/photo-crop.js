const fullPage = () => [[0,0],[1,0],[1,1],[0,1]];
const distance = ([x,y],[a,b]) => Math.hypot(x-a,y-b);

function validPage(points) {
  return points.every(([x,y],i) => {
    const [a,b] = points[(i+1)%4], [c,d] = points[(i+2)%4];
    return (a-x)*(d-b)-(b-y)*(c-a) > .008;
  });
}

function detectPage(image) {
  const scale = Math.min(1,360/Math.max(image.width,image.height));
  const sample = document.createElement('canvas');
  sample.width = Math.max(1,Math.round(image.width*scale));
  sample.height = Math.max(1,Math.round(image.height*scale));
  const {width,height} = sample;
  const ctx = sample.getContext('2d');
  ctx.drawImage(image,0,0,width,height);
  const {data} = ctx.getImageData(0,0,width,height);
  const bright = new Uint8Array(width*height);
  for (let i=0;i<bright.length;i++) {
    const r=data[i*4],g=data[i*4+1],b=data[i*4+2];
    bright[i] = Math.min(r,g,b)>160 && Math.max(r,g,b)-Math.min(r,g,b)<42;
  }
  const queue=new Int32Array(bright.length);
  let best=[], bestSize=0;
  for(let start=0;start<bright.length;start++){
    if(!bright[start]) continue;
    let size=1;
    queue[0]=start;
    bright[start]=0;
    const scores=[Infinity,Infinity,Infinity,Infinity], corners=[];
    for(let head=0;head<size;head++){
      const i=queue[head], col=i%width, row=Math.floor(i/width);
      const x=(col+.5)/width,y=(row+.5)/height;
      const score=[x+y,y-x,-x-y,x-y];
      for(let j=0;j<4;j++) if(score[j]<scores[j]){
        scores[j]=score[j];
        corners[j]=[x,y];
      }
      for(const n of [col>0?i-1:-1,col<width-1?i+1:-1,i-width,i+width]){
        if(n>=0 && n<bright.length && bright[n]){
          queue[size++]=n;
          bright[n]=0;
        }
      }
    }
    if(size>bestSize){bestSize=size;best=corners}
  }
  return bestSize>bright.length*.35 && validPage(best) &&
    best.every(([x,y])=>x>.015&&x<.985&&y>.015&&y<.985) ? best : fullPage();
}

export function pageProjection([[x0,y0],[x1,y1],[x2,y2],[x3,y3]]) {
  const dx1=x1-x2,dx2=x3-x2,dy1=y1-y2,dy2=y3-y2;
  const dx=x0-x1+x2-x3,dy=y0-y1+y2-y3;
  const det=dx1*dy2-dx2*dy1;
  const g=(dx*dy2-dx2*dy)/det,h=(dx1*dy-dx*dy1)/det;
  const a=x1-x0+g*x1,b=x3-x0+h*x3,c=y1-y0+g*y1,d=y3-y0+h*y3;
  return (u,v)=>{
    const z=1+g*u+h*v;
    return [(x0+a*u+b*v)/z,(y0+c*u+d*v)/z];
  };
}

async function rectify(image, points) {
  const source=document.createElement('canvas');
  const scale=Math.min(1,8000/Math.max(image.width,image.height),Math.sqrt(16000000/(image.width*image.height)));
  source.width=Math.max(1,Math.round(image.width*scale));
  source.height=Math.max(1,Math.round(image.height*scale));
  const ctx=source.getContext('2d');
  ctx.drawImage(image,0,0,source.width,source.height);
  const {data}=ctx.getImageData(0,0,source.width,source.height);
  const pixels=points.map(([x,y])=>[x*source.width,y*source.height]);
  const width=Math.max(distance(pixels[0],pixels[1]),distance(pixels[2],pixels[3]));
  const height=Math.max(distance(pixels[0],pixels[3]),distance(pixels[1],pixels[2]));
  const factor=Math.min(1,8000/Math.max(width,height),Math.sqrt(16000000/(width*height)));
  const output=document.createElement('canvas');
  output.width=Math.max(1,Math.round(width*factor));
  output.height=Math.max(1,Math.round(height*factor));
  const out=output.getContext('2d');
  const frame=out.createImageData(output.width,output.height);
  const project=pageProjection(pixels);
  for(let y=0;y<output.height;y++) for(let x=0;x<output.width;x++){
    const [sx,sy]=project((x+.5)/output.width,(y+.5)/output.height);
    const i=(Math.max(0,Math.min(source.height-1,Math.floor(sy)))*source.width+Math.max(0,Math.min(source.width-1,Math.floor(sx))))*4;
    const j=(y*output.width+x)*4;
    frame.data[j]=data[i];frame.data[j+1]=data[i+1];frame.data[j+2]=data[i+2];frame.data[j+3]=255;
  }
  out.putImageData(frame,0,0);
  return new Promise(resolve=>output.toBlob(resolve,'image/jpeg',.96));
}

export function photoCrop(image, canvas, reset) {
  let points=detectPage(image), active=null;
  const scale=Math.min(1,720/image.width,540/image.height);
  canvas.width=Math.max(1,Math.round(image.width*scale));
  canvas.height=Math.max(1,Math.round(image.height*scale));
  const ctx=canvas.getContext('2d');
  function paint(){
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    ctx.beginPath();
    ctx.rect(0,0,canvas.width,canvas.height);
    points.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x*canvas.width,y*canvas.height));
    ctx.closePath();
    ctx.fillStyle='rgba(0,0,0,.46)';
    ctx.fill('evenodd');
    ctx.strokeStyle='#38bdf8';ctx.lineWidth=3;ctx.stroke();
    for(const [x,y] of points){
      ctx.beginPath();
      ctx.arc(x*canvas.width,y*canvas.height,8,0,Math.PI*2);
      ctx.fillStyle='#fff';ctx.fill();ctx.stroke();
    }
  }
  const position=event=>{
    const rect=canvas.getBoundingClientRect();
    return [(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height];
  };
  canvas.onpointerdown=event=>{
    const p=position(event);
    const rect=canvas.getBoundingClientRect();
    const distances=points.map(([x,y])=>Math.hypot((x-p[0])*rect.width,(y-p[1])*rect.height));
    const closest=Math.min(...distances);
    if(closest>34) return;
    active=distances.indexOf(closest);
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove=event=>{
    if(active===null) return;
    const next=points.map((p,i)=>i===active?position(event).map(v=>Math.max(0,Math.min(1,v))):p);
    if(validPage(next)){points=next;paint()}
  };
  canvas.onpointerup=canvas.onpointercancel=()=>{active=null};
  reset.onclick=()=>{points=fullPage();paint()};
  paint();
  return async file=>points.every((p,i)=>distance(p,fullPage()[i])<.001)?file:rectify(image,points);
}
