import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
const normals={1:[0,0,1],6:[0,0,-1],2:[0,1,0],5:[0,-1,0],3:[1,0,0],4:[-1,0,0]};
const patterns={1:[[0,0]],2:[[-1,1],[1,-1]],3:[[-1,1],[0,0],[1,-1]],4:[[-1,1],[1,1],[-1,-1],[1,-1]],5:[[-1,1],[1,1],[0,0],[-1,-1],[1,-1]],6:[[-1,1],[1,1],[-1,0],[1,0],[-1,-1],[1,-1]]};
const zAxis=new THREE.Vector3(0,0,1),yAxis=new THREE.Vector3(0,1,0);
class ZappoDice {
 constructor(card,board,dock){
  this.card=card;this.board=board;this.dock=dock;this.token=0;this.mode='hidden';this.values=[1,1];this.raf=0;this.objects=[];
  this.host=document.createElement('div');this.host.className='dice-3d-host';this.host.setAttribute('role','img');this.card.appendChild(this.host);
  this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,6000);this.camera.position.set(0,0,1400);this.camera.lookAt(0,0,0);
  try{
   this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));this.renderer.setClearColor(0,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.92;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.host.appendChild(this.renderer.domElement);
   const env=new RoomEnvironment();const pmrem=new THREE.PMREMGenerator(this.renderer);this.environment=pmrem.fromScene(env,.04);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.065;env.dispose();pmrem.dispose();
   this.scene.add(new THREE.HemisphereLight(0xffffff,0x61323d,1.5));
   const light=new THREE.DirectionalLight(0xfff4df,1.8);light.position.set(-180,240,1000);light.castShadow=true;light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-900,right:900,top:900,bottom:-900,near:1,far:2000});light.shadow.bias=-.001;light.shadow.normalBias=.03;light.shadow.radius=3;this.scene.add(light);
   const fill=new THREE.DirectionalLight(0xbddaff,.65);fill.position.set(250,-130,250);this.scene.add(fill);
   const ground=new THREE.Mesh(new THREE.PlaneGeometry(5000,5000),new THREE.ShadowMaterial({opacity:.20,depthWrite:false}));ground.receiveShadow=true;ground.position.z=-.3;this.scene.add(ground);
   this.paperCanvas=document.createElement('canvas');this.paperTexture=new THREE.CanvasTexture(this.paperCanvas);this.paperTexture.colorSpace=THREE.SRGBColorSpace;
   this.paper=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:this.paperTexture,depthWrite:false,toneMapped:false}));this.paper.position.z=-.4;
   // Paper is sampled only by the glass refraction pass; the real DOM remains visible.
   this.paper.onBeforeRender=renderer=>{this.paper.material.colorWrite=renderer.getRenderTarget()!==null};this.scene.add(this.paper);
   const bodyGeo=new RoundedBoxGeometry(1,1,1,4,.115);
   const bodyMat=new THREE.MeshPhysicalMaterial({color:0xf36c87,roughness:.085,metalness:0,transmission:.94,thickness:.8,ior:1.48,attenuationColor:0xa9082d,attenuationDistance:90,clearcoat:1,clearcoatRoughness:.06});
   const pipGeo=new THREE.CylinderGeometry(.069,.069,.016,18);const pipMat=new THREE.MeshStandardMaterial({color:0xfff8ec,roughness:.23,metalness:.02});
   for(let i=0;i<2;i++){
    const g=new THREE.Group();const body=new THREE.Mesh(bodyGeo,bodyMat);body.castShadow=true;body.receiveShadow=true;g.add(body);
    for(const [value,n] of Object.entries(normals)){
     const normal=new THREE.Vector3(...n),rot=new THREE.Quaternion().setFromUnitVectors(zAxis,normal);
     for(const [u,v] of patterns[value]){const pip=new THREE.Mesh(pipGeo,pipMat);pip.position.copy(new THREE.Vector3(u*.235,v*.235,.499).applyQuaternion(rot));pip.quaternion.setFromUnitVectors(yAxis,normal);pip.userData.face=Number(value);g.add(pip)}
    }
    this.scene.add(g);this.objects.push(g);
   }
   this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.toFallback()});
  }catch(error){this.toFallback()}
  this.measure();this.host.style.display='none';this.draw();
  this.observer=new ResizeObserver(()=>{if(this.mode==='parked'){this.measure();this.parkPose();this.draw()}});this.observer.observe(card);
 }
 toFallback(){
  if(this.fallback)return;this.fallback=true;if(this.renderer){this.renderer.domElement.style.display='none'}
  this.host.classList.add('css-3d-fallback');this.fallbackDice=[];
  const rotations={1:'',6:'rotateY(180deg)',2:'rotateX(90deg)',5:'rotateX(-90deg)',3:'rotateY(90deg)',4:'rotateY(-90deg)'};
  for(let i=0;i<2;i++){const cube=document.createElement('div');cube.className='physical-cube';for(const [v,pattern] of Object.entries(patterns)){const face=document.createElement('div');face.className='physical-face';face.style.transform=rotations[v]+' translateZ(32px)';for(const [u,y] of pattern){const pip=document.createElement('i');pip.style.left=(50+u*23.5)+'%';pip.style.top=(50-y*23.5)+'%';face.appendChild(pip)}cube.appendChild(face)}this.host.appendChild(cube);this.fallbackDice.push(cube)}
  if(!this.objects.length)for(let i=0;i<2;i++)this.objects.push(new THREE.Group());
 }
 measure(){
  const c=this.card.getBoundingClientRect();this.width=c.width;this.height=c.height;
  this.camera.left=-c.width/2;this.camera.right=c.width/2;this.camera.top=c.height/2;this.camera.bottom=-c.height/2;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
  if(this.renderer&&!this.fallback)this.renderer.setSize(c.width,c.height,false);
  this.cardRect=c;this.boardRect=this.board.getBoundingClientRect();this.dockRect=this.dock.getBoundingClientRect();this.updatePaper();
 }
 updatePaper(){
  if(!this.paperCanvas||this.fallback)return;
  const canvas=this.paperCanvas;canvas.width=Math.ceil(this.width);canvas.height=Math.ceil(this.height);const ctx=canvas.getContext('2d');
  ctx.fillStyle='#f8f2e3';ctx.fillRect(0,0,canvas.width,canvas.height);
  const img=document.getElementById('dicePaperTexture');if(img?.complete&&img.naturalWidth){ctx.drawImage(img,img.naturalWidth/3,0,img.naturalWidth/3,img.naturalHeight,0,0,canvas.width,canvas.height);ctx.fillStyle='#ffffff88';ctx.fillRect(0,0,canvas.width,canvas.height)}
  this.board.querySelectorAll('.cell').forEach(cell=>{const r=cell.getBoundingClientRect(),x=r.left-this.cardRect.left,y=r.top-this.cardRect.top,style=getComputedStyle(cell);ctx.fillStyle=style.backgroundColor;ctx.fillRect(x,y,r.width,r.height);ctx.strokeStyle='#596d7688';ctx.lineWidth=1;ctx.strokeRect(x,y,r.width,r.height);ctx.fillStyle='#185bc5';ctx.font=`600 ${style.fontSize} Hand`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(cell.textContent,x+r.width/2,y+r.height/2)});
  this.paper.scale.set(this.width,this.height,1);this.paperTexture.needsUpdate=true;
 }
 orientation(value,i){
  const face=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...normals[value]),zAxis);
  return new THREE.Quaternion().setFromAxisAngle(zAxis,i?.18:-.16).multiply(face);
 }
 point(x,y,z){
  const p=new THREE.Vector3(x/this.width*2-1,1-y/this.height*2,0).unproject(this.camera),d=this.camera.getWorldDirection(new THREE.Vector3());
  return p.addScaledVector(d,(z-p.z)/d.z);
 }
 pose(i,x,y,size,q,lift=0){
  const g=this.objects[i],m=new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
  const extent=(Math.abs(m[2])+Math.abs(m[6])+Math.abs(m[10]))*.5*size;
  // Support height follows the solid cube, preventing faces from cutting through the paper.
  g.position.copy(this.point(x,y,size*.5));g.position.z=extent+lift;g.quaternion.copy(q);g.scale.setScalar(size);
 }
 draw(){
  if(this.fallback){
   const basis=new THREE.Matrix4().makeScale(1,-1,1),view=this.camera.quaternion.clone().invert();
   this.objects.forEach((g,i)=>{const p=g.position.clone().project(this.camera),rot=new THREE.Quaternion().copy(view).multiply(g.quaternion),m=new THREE.Matrix4().makeRotationFromQuaternion(rot);m.premultiply(basis);m.multiply(basis);const size=g.scale.x/64;this.fallbackDice[i].style.transform=`translate(${(p.x+1)*this.width/2-32}px,${(1-p.y)*this.height/2-32}px) scale(${size}) matrix3d(${m.elements.join(',')})`});
  }else this.renderer.render(this.scene,this.camera);
 }
 dockPositions(){const r=this.dockRect,c=this.cardRect,size=this.width<400?34:39;return [0,1].map(i=>({x:r.left-c.left+25+i*(size+19),y:r.top-c.top+r.height*.47,size}))}
 parkPose(){const ps=this.dockPositions();ps.forEach((p,i)=>this.pose(i,p.x,p.y,p.size,this.orientation(this.values[i],i)))}
 show(a,b){
  if(this.mode==='rolling'||this.mode==='parking')return;
  this.values=[a,b];this.host.style.display='block';this.host.setAttribute('aria-label',`Würfel ${a} und ${b}`);this.mode='parked';this.measure();this.parkPose();this.draw();
 }
 hide(){this.token++;cancelAnimationFrame(this.raf);this.mode='hidden';this.host.style.display='none'}
 roll(a,b,{onDone,onImpact,reduced=false}={}){
  this.hide();const token=this.token;this.values=[a,b];this.mode='rolling';this.host.style.display='block';this.host.setAttribute('aria-label','Würfel rollen');this.measure();
  const c=this.cardRect,r=this.boardRect,baseSize=Math.min(62,r.width*.18),start=performance.now();
  const targets=[0,1].map(i=>({x:r.left-c.left+r.width*(i?.70:.29),y:r.top-c.top+r.height*(i?.53:.43),size:baseSize,q:this.orientation(this.values[i],i)}));
  const begins=[0,1].map(i=>({x:r.left-c.left+r.width*(i?.86:.14),y:r.top-c.top+r.height*.16}));
  const axes=[new THREE.Vector3(.7,.45,.18).normalize(),new THREE.Vector3(-.45,.8,-.2).normalize()];
  const rollMs=reduced?120:1800,holdMs=reduced?0:260,parkMs=reduced?100:520,impacts=[.29,.52,.71,.855],sent=new Set();
  const bounce=t=>{const knots=[0,.29,.52,.71,.855,1],heights=[48,27,12,4,0];let j=knots.findIndex((x,i)=>i<5&&t>=x&&t<=knots[i+1]);if(j<0)j=4;const u=(t-knots[j])/(knots[j+1]-knots[j]);return heights[j]*4*u*(1-u)};
  const frame=now=>{
   if(token!==this.token)return;
   const elapsed=now-start,t=Math.min(1,elapsed/rollMs),q=1-Math.pow(1-t,2.4);
   if(elapsed<rollMs+holdMs){
    targets.forEach((end,i)=>{const turn=new THREE.Quaternion().setFromAxisAngle(axes[i],(1-q)*(Math.PI*3.3+i*.7)),orientation=end.q.clone().multiply(turn);this.pose(i,begins[i].x+(end.x-begins[i].x)*q,begins[i].y+(end.y-begins[i].y)*q,end.size,reduced?end.q:orientation,reduced?0:bounce(t))});
    impacts.forEach((at,k)=>{if(t>=at&&!sent.has(k)&&!reduced){sent.add(k);onImpact?.(k)}});
   }else{
    this.mode='parking';const p=Math.min(1,(elapsed-rollMs-holdMs)/parkMs),ease=p*p*(3-2*p),docks=this.dockPositions();
    targets.forEach((end,i)=>{const d=docks[i];this.pose(i,end.x+(d.x-end.x)*ease,end.y+(d.y-end.y)*ease,end.size+(d.size-end.size)*ease,end.q)});
   }
   this.draw();
   if(elapsed>=rollMs+holdMs+parkMs){this.mode='parked';this.parkPose();this.draw();this.host.setAttribute('aria-label',`Würfel ${a} und ${b}`);onDone?.();return}
   this.raf=requestAnimationFrame(frame);
  };this.raf=requestAnimationFrame(frame);
 }
 inspect(){return {mode:this.mode,values:this.values,fallback:!!this.fallback,faces:{...patterns},top:this.objects.map(g=>Number(Object.keys(normals).reduce((best,v)=>new THREE.Vector3(...normals[v]).applyQuaternion(g.quaternion).z>new THREE.Vector3(...normals[best]).applyQuaternion(g.quaternion).z?v:best,'1'))),pipFaces:this.objects.map(g=>g.children.filter(x=>x.userData.face).map(x=>x.userData.face))}}
}
window.ZappoDice=ZappoDice;
