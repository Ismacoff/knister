'use strict';
const $=id=>document.getElementById(id);
const screens=['home','lobby','game'];
let peer=null, hostConn=null, role=null, roomCode='', myName='', myPeerId='', phase='home';
let conns=new Map();
let room={phase:'lobby',turn:0,currentRoll:null,dice:[1,1],players:{}};
let isRolling=false;
let myBoard=Array(25).fill(null), myPlaced=false, lastPlacedIndex=null;
const lines=[[0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24],[0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],[0,6,12,18,24],[20,16,12,8,4]];
function show(id){screens.forEach(s=>$(s).classList.toggle('active',s===id));phase=id}
function safeName(s){return String(s||'').trim().replace(/\s+/g,' ').slice(0,20)}
function randomCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:5},()=>chars[Math.floor(Math.random()*chars.length)]).join('')}
function setNet(text,on=true){$('netText').textContent=text;$('netDot').classList.toggle('on',on)}
function msg(where,text,bad=false){const e=$(where);e.textContent=text;e.className='message'+(bad?' bad':'');e.classList.remove('hide')}
function hideMsg(where){$(where).classList.add('hide')}
function scoreLine(vals){if(vals.some(v=>v==null))return 0;const f={};vals.forEach(v=>f[v]=(f[v]||0)+1);const c=Object.values(f).sort((a,b)=>b-a),u=[...new Set(vals)].sort((a,b)=>a-b);if(c[0]===5)return 10;if(c[0]===4)return 6;if(c[0]===3&&c[1]===2)return 8;if(c[0]===3)return 3;if(c[0]===2&&c[1]===2)return 3;if(c[0]===2)return 1;if(u.length===5&&u[4]-u[0]===4)return u.includes(7)?8:12;return 0}
function score(board){const x=lines.map((a,i)=>scoreLine(a.map(k=>board[k]))*(i>=10?2:1));return{rows:x.slice(0,5).reduce((a,b)=>a+b,0),cols:x.slice(5,10).reduce((a,b)=>a+b,0),diag:x.slice(10).reduce((a,b)=>a+b,0),total:x.reduce((a,b)=>a+b,0)}}
function playerSummary(){return Object.values(room.players).map(p=>({id:p.id,name:p.name,score:p.score||0,filled:p.filled||0,placed:!!p.placed,host:!!p.host})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name))}
function hostPayload(){return{type:'state',phase:room.phase,turn:room.turn,currentRoll:room.currentRoll,dice:room.dice,players:playerSummary()}}
function broadcast(){if(role==='host'&&room.phase==='game'&&room.turn>=25&&Object.values(room.players).length&&Object.values(room.players).every(p=>p.placed)){room.phase='finished';room.currentRoll=null}const p=hostPayload();conns.forEach(c=>{if(c.open)try{c.send(p)}catch(e){}});renderFromRoom()}
function setupConn(conn){
 conn.on('data',data=>handleHostData(conn,data));
 conn.on('close',()=>{conns.delete(conn.peer);if(room.players[conn.peer]){delete room.players[conn.peer];broadcast()}});
 conn.on('error',()=>{});
}
function handleHostData(conn,d){
 if(!d||typeof d!=='object')return;
 if(d.type==='join'){
   if(room.phase!=='lobby'){conn.send({type:'error',message:'Dieses Spiel läuft bereits.'});setTimeout(()=>conn.close(),300);return}
   const n=safeName(d.name)||'Spieler';
   room.players[conn.peer]={id:conn.peer,name:n,score:0,filled:0,placed:false,host:false};
   conns.set(conn.peer,conn);conn.send(hostPayload());broadcast();return;
 }
 const p=room.players[conn.peer]; if(!p)return;
 if(d.type==='placed'&&room.phase==='game'&&d.turn===room.turn&&!p.placed&&Array.isArray(d.board)&&d.board.length===25){
   const valid=d.board.every(v=>v===null||(Number.isInteger(v)&&v>=2&&v<=12));if(!valid)return;
   const filled=d.board.filter(v=>v!==null).length;if(filled!==room.turn)return;
   const sc=score(d.board);p.score=sc.total;p.filled=filled;p.placed=true;broadcast();return;
 }
 if(d.type==='undo'&&room.phase==='game'&&!isRolling&&d.turn===room.turn&&p.placed&&Array.isArray(d.board)&&d.board.length===25){
   const valid=d.board.every(v=>v===null||(Number.isInteger(v)&&v>=2&&v<=12));if(!valid)return;
   const filled=d.board.filter(v=>v!==null).length;if(filled!==room.turn-1)return;
   const sc=score(d.board);p.score=sc.total;p.filled=filled;p.placed=false;broadcast();
 }
}
function destroyPeer(){try{if(hostConn)hostConn.close()}catch(e){};try{conns.forEach(c=>c.close())}catch(e){};try{if(peer)peer.destroy()}catch(e){};peer=null;hostConn=null;conns.clear();role=null;roomCode='';myPeerId='';room={phase:'lobby',turn:0,currentRoll:null,dice:[1,1],players:{}};myBoard=Array(25).fill(null);myPlaced=false;lastPlacedIndex=null;setNet('Bereit',false)}
function getName(){const n=safeName($('nameInput').value);if(!n){$('nameInput').focus();return null}localStorage.setItem('knister-name',n);return n}
function createHost(){
 myName=getName();if(!myName)return;destroyPeer();role='host';roomCode=randomCode();setNet('Verbinde …',false);hideMsg('lobbyMsg');
 function attempt(){
   const id='knister-'+roomCode.toLowerCase();peer=new Peer(id);
   peer.on('open',pid=>{myPeerId=pid;room.players[pid]={id:pid,name:myName,score:0,filled:0,placed:false,host:true};setNet('Online');$('roomCode').textContent=roomCode;show('lobby');renderLobby();});
   peer.on('connection',conn=>setupConn(conn));
   peer.on('error',err=>{if(err.type==='unavailable-id'){try{peer.destroy()}catch(e){};roomCode=randomCode();attempt()}else{setNet('Verbindungsfehler',false);msg('lobbyMsg','Online-Verbindung konnte nicht aufgebaut werden: '+(err.type||'Fehler'),true);show('lobby')}});
 }
 attempt();
}
function joinRoom(){
 myName=getName();if(!myName)return;const code=$('codeInput').value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');if(code.length!==5){$('codeInput').focus();return}
 destroyPeer();role='guest';roomCode=code;setNet('Verbinde …',false);hideMsg('lobbyMsg');peer=new Peer();
 peer.on('open',pid=>{myPeerId=pid;hostConn=peer.connect('knister-'+code.toLowerCase(),{reliable:true});hostConn.on('open',()=>{hostConn.send({type:'join',name:myName});setNet('Online')});hostConn.on('data',handleGuestData);hostConn.on('close',()=>{setNet('Verbindung beendet',false);msg(phase==='game'?'gameMsg':'lobbyMsg','Der Spielleiter hat den Raum verlassen.',true)});hostConn.on('error',()=>msg('lobbyMsg','Verbindung zum Raum fehlgeschlagen.',true));});
 peer.on('error',err=>{if(err.type==='peer-unavailable')msg('lobbyMsg','Raum nicht gefunden. Prüfe den Code.',true);else msg('lobbyMsg','Verbindungsfehler: '+(err.type||'unbekannt'),true);setNet('Nicht verbunden',false);show('lobby')});
 $('roomCode').textContent=code;show('lobby');renderLobby();
}
function handleGuestData(d){
 if(!d||typeof d!=='object')return;if(d.type==='error'){msg('lobbyMsg',d.message||'Beitritt nicht möglich.',true);return}
 if(d.type==='state'){const prevTurn=room.turn;room.phase=d.phase;room.turn=d.turn;room.currentRoll=d.currentRoll;room.dice=Array.isArray(d.dice)?d.dice:[1,1];room.players={};(d.players||[]).forEach(p=>room.players[p.id]=p);if(d.turn>prevTurn&&d.currentRoll!=null){lastPlacedIndex=null;animateDice(room.dice[0],room.dice[1],false);}
   if(room.phase==='game'&&phase!=='game'){myBoard=Array(25).fill(null);myPlaced=false;show('game')}
   const me=room.players[myPeerId];if(me)myPlaced=!!me.placed;renderFromRoom();
 }
}
function renderLobby(){
 $('startBtn').classList.toggle('hide',role!=='host');$('startBtn').disabled=role!=='host'||Object.keys(room.players).length<1;$('roomCode').textContent=roomCode||'-----';
 const ps=playerSummary();$('playerCount').textContent=ps.length+' '+(ps.length===1?'Spieler':'Spieler');
 $('lobbyPlayers').innerHTML=ps.map(p=>`<div class="player"><div class="avatar">${escapeHtml(p.name.slice(0,1).toUpperCase())}</div><div class="pinfo"><b>${escapeHtml(p.name)} ${p.id===myPeerId?'· du':''}</b><small>${p.host?'Spielleiter':'bereit'}</small></div></div>`).join('')||'<div class="mini">Noch niemand im Raum.</div>';
}
function startGame(){
 if(role!=='host')return;room.phase='game';room.turn=0;room.currentRoll=null;room.dice=[1,1];myBoard=Array(25).fill(null);myPlaced=false;lastPlacedIndex=null;Object.values(room.players).forEach(p=>{p.score=0;p.filled=0;p.placed=false});show('game');broadcast()
}
function renderBoard(){
 const sc=score(myBoard);$('sRows').textContent=sc.rows;$('sCols').textContent=sc.cols;$('sDiag').textContent=sc.diag;$('sTotal').textContent=sc.total;
 $('progress').style.width=(myBoard.filter(v=>v!==null).length*4)+'%';
 $('board').innerHTML=myBoard.map((v,i)=>`<button class="cell ${(Math.floor(i/5)===i%5||Math.floor(i/5)+i%5===4)?'diag':''} ${v===null&&room.currentRoll!==null&&!myPlaced?'ready':''}" data-cell="${i}" ${v!==null||room.currentRoll===null||myPlaced||room.phase!=='game'?'disabled':''}>${v==null?'·':v}</button>`).join('');
 const rowValues=Array.from({length:5},(_,r)=>scoreLine(myBoard.slice(r*5,r*5+5)));
 const columnValues=Array.from({length:5},(_,c)=>scoreLine(Array.from({length:5},(_,r)=>myBoard[r*5+c])));
 const diagonalValues=[
  scoreLine([0,6,12,18,24].map(i=>myBoard[i]))*2,
  scoreLine([4,8,12,16,20].map(i=>myBoard[i]))*2
 ];
 $('rowScores').innerHTML=rowValues.map((v,r)=>`<div title="Reihe ${r+1}: ${v} Punkte"><small>R${r+1}</small><b>${v}</b></div>`).join('');
 $('columnScores').innerHTML=columnValues.map((v,c)=>`<div title="Spalte ${c+1}: ${v} Punkte"><small>S${c+1}</small><b>${v}</b></div>`).join('');
 $('diagonalScores').innerHTML=diagonalValues.map((v,d)=>`<div title="Diagonale ${d+1}: ${v} Punkte, doppelt gewertet"><small>${d===0?'↘':'↙'} ×2</small><b>${v}</b></div>`).join('');
}
function renderFromRoom(){
 if(room.phase==='lobby'){renderLobby();return}
 $('gameName').textContent=myName;$('turnLabel').textContent='Wurf '+room.turn+' / 25';$('currentRoll').textContent=room.currentRoll==null?'–':room.currentRoll;if(!isRolling)showSettledDice();
 const ps=playerSummary(),ready=ps.filter(p=>p.placed).length,all=ps.length>0&&ready===ps.length;
 $('readyCount').textContent=room.currentRoll==null?'':ready+' / '+ps.length+' platziert';
 $('standings').innerHTML=ps.map((p,i)=>`<div class="standing"><span>${i+1}</span><div><b>${escapeHtml(p.name)}${p.id===myPeerId?' · du':''}</b><div class="${p.placed?'check':'wait'}">${room.currentRoll==null?'bereit':p.placed?'✓ platziert':'wartet …'}</div></div><span class="score">${p.score||0}</span></div>`).join('');
 $('hostControls').classList.toggle('hide',role!=='host'||room.turn>=25);if($('diceBtn'))$('diceBtn').disabled=role!=='host'||isRolling||(room.currentRoll!==null&&!all)||room.turn>=25;
 if($('undoBtn'))$('undoBtn').disabled=!myPlaced||lastPlacedIndex==null||isRolling||room.phase!=='game';
 if(room.phase==='finished')finishGame();else{$('winnerBox').classList.add('hide');$('newGameBtn').classList.add('hide')}
 $('turnHint').textContent=room.phase==='finished'?'Runde beendet.':isRolling?'Die Würfel rollen …':room.currentRoll==null?(role==='host'?'Tippe auf „Würfeln“.':'Warte auf den ersten Wurf.'):(myPlaced?'Eingetragen – warte auf die anderen.':'Tippe ein freies Feld an.');
 $('hostHint').textContent=room.currentRoll!==null&&!all?'Noch '+(ps.length-ready)+' Spieler müssen platzieren.':'Alle bereit für den nächsten Wurf.';
 renderBoard();
}
let audioCtx=null;
function audioReady(){
 try{if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume()}catch(e){}
}
function thud(at=0,volume=.16,pitch=95){
 if(!audioCtx)return;const t=audioCtx.currentTime+at;
 const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type='triangle';osc.frequency.setValueAtTime(pitch,t);osc.frequency.exponentialRampToValueAtTime(42,t+.09);gain.gain.setValueAtTime(volume,t);gain.gain.exponentialRampToValueAtTime(.001,t+.11);osc.connect(gain).connect(audioCtx.destination);osc.start(t);osc.stop(t+.12);
 const len=Math.floor(audioCtx.sampleRate*.045),buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),data=buf.getChannelData(0);for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*(1-i/len);const src=audioCtx.createBufferSource(),ng=audioCtx.createGain();src.buffer=buf;ng.gain.setValueAtTime(volume*.45,t);ng.gain.exponentialRampToValueAtTime(.001,t+.05);src.connect(ng).connect(audioCtx.destination);src.start(t);
}
function diceSound(){
 audioReady();if(!audioCtx)return;thud(.05,.08,150);thud(.23,.10,125);thud(.43,.12,108);thud(.68,.14,92);thud(.96,.16,78);thud(1.18,.22,65);
}
function setDie(el,value){
 if(!el)return;
 value=Math.max(1,Math.min(6,Number(value)||1));
 el.setAttribute('data-value',String(value));
 el.setAttribute('aria-label','Würfel zeigt '+value);
}
function settledTransforms(){
 const board=$('board'),w=board?.clientWidth||320,h=board?.clientHeight||320;
 return [
  `translate(${w*.36}px,${h*.42}px) rotate(-18deg) scale(1)`,
  `translate(${w*.57}px,${h*.48}px) rotate(14deg) scale(1)`
 ];
}
function showSettledDice(){
 const overlay=$('diceOverlay'),fly1=$('flyDie1'),fly2=$('flyDie2');
 if(!overlay||!fly1||!fly2)return;
 if(room.currentRoll==null){overlay.classList.remove('active');return}
 setDie(fly1,room.dice?.[0]||1);setDie(fly2,room.dice?.[1]||1);
 fly1.getAnimations().forEach(x=>x.cancel());fly2.getAnimations().forEach(x=>x.cancel());
 const [t1,t2]=settledTransforms();fly1.style.transform=t1;fly2.style.transform=t2;
 overlay.classList.add('active');
}
function animateDice(a,b,commit=true){
 const fly1=$('flyDie1'),fly2=$('flyDie2'),board=$('board'),overlay=$('diceOverlay');
 if(!fly1||!fly2||!board||!overlay){isRolling=false;return}
 diceSound();setDie(fly1,a);setDie(fly2,b);
 fly1.getAnimations().forEach(x=>x.cancel());fly2.getAnimations().forEach(x=>x.cancel());
 fly1.style.transform='';fly2.style.transform='';overlay.classList.remove('active');void overlay.offsetWidth;overlay.classList.add('active');
 const w=board.clientWidth,h=board.clientHeight,size=Math.min(68,Math.max(54,w*.16));
 const [end1,end2]=settledTransforms();
 const path1=[
  {transform:`translate(${-size*1.3}px,${-size*.65}px) rotate(-80deg) scale(.65)`,offset:0},
  {transform:`translate(${w*.18}px,${h*.10}px) rotate(155deg) scale(1.08)`,offset:.25},
  {transform:`translate(${w*.60}px,${h*.38}px) rotate(385deg) scale(.90)`,offset:.52},
  {transform:`translate(${w*.34}px,${h*.19}px) rotate(505deg) scale(1.03)`,offset:.72},
  {transform:end1,offset:1}
 ];
 const path2=[
  {transform:`translate(${w+size*.25}px,${-size*.8}px) rotate(95deg) scale(.62)`,offset:0},
  {transform:`translate(${w*.68}px,${h*.12}px) rotate(-145deg) scale(1.07)`,offset:.24},
  {transform:`translate(${w*.22}px,${h*.45}px) rotate(-390deg) scale(.91)`,offset:.53},
  {transform:`translate(${w*.55}px,${h*.24}px) rotate(-510deg) scale(1.04)`,offset:.73},
  {transform:end2,offset:1}
 ];
 const opts={duration:1650,easing:'cubic-bezier(.16,.72,.18,1)',fill:'forwards'};
 fly1.animate(path1,opts);fly2.animate(path2,opts);
 let ticks=0;const timer=setInterval(()=>{if(++ticks<10){setDie(fly1,1+Math.floor(Math.random()*6));setDie(fly2,1+Math.floor(Math.random()*6))}},110);
 setTimeout(()=>{clearInterval(timer);setDie(fly1,a);setDie(fly2,b)},1320);
 setTimeout(()=>{
  isRolling=false;
  if(commit){
   room.dice=[a,b];room.turn++;room.currentRoll=a+b;Object.values(room.players).forEach(p=>p.placed=false);myPlaced=false;lastPlacedIndex=null;
   showSettledDice();broadcast();
  }else{
   showSettledDice();renderFromRoom();
  }
 },1700);
}
function rollDice(){
 if(role!=='host'||room.turn>=25||isRolling)return;
 const ps=playerSummary(),all=ps.length>0&&ps.every(p=>p.placed);
 if(room.currentRoll!==null&&!all)return;
 isRolling=true;renderFromRoom();
 const a=1+Math.floor(Math.random()*6),b=1+Math.floor(Math.random()*6);
 animateDice(a,b,true);
}
function place(i){
 if(room.phase!=='game'||myPlaced||room.currentRoll==null||myBoard[i]!=null)return;myBoard[i]=room.currentRoll;myPlaced=true;lastPlacedIndex=i;
 const sc=score(myBoard);
 if(role==='host'){const me=room.players[myPeerId];me.score=sc.total;me.filled=room.turn;me.placed=true;broadcast()}
 else if(hostConn&&hostConn.open){hostConn.send({type:'placed',turn:room.turn,board:myBoard})}
 renderBoard();renderFromRoom()
}
function undoLastMove(){
 if(room.phase!=='game'||isRolling||!myPlaced||lastPlacedIndex==null)return;
 myBoard[lastPlacedIndex]=null;lastPlacedIndex=null;myPlaced=false;
 const sc=score(myBoard);
 if(role==='host'){
  const me=room.players[myPeerId];if(me){me.score=sc.total;me.filled=Math.max(0,room.turn-1);me.placed=false}broadcast();
 }else if(hostConn&&hostConn.open){
  hostConn.send({type:'undo',turn:room.turn,board:myBoard});
 }
 renderBoard();renderFromRoom();
}
function finishGame(){
 const ps=playerSummary();if(!ps.length)return;const top=ps[0].score,w=ps.filter(p=>p.score===top);
 $('winnerBox').innerHTML=`<div class="label">Runde beendet</div><b>${escapeHtml(w.map(x=>x.name).join(' & '))}</b><div>${top} Punkte</div>`;$('winnerBox').classList.remove('hide');$('newGameBtn').classList.toggle('hide',role!=='host');$('hostControls').classList.add('hide');
 if(role==='host'&&room.phase!=='finished'){room.phase='finished';broadcast()}
}
function newRound(){if(role!=='host')return;$('winnerBox').classList.add('hide');$('newGameBtn').classList.add('hide');room.phase='game';room.turn=0;room.currentRoll=null;room.dice=[1,1];myBoard=Array(25).fill(null);myPlaced=false;lastPlacedIndex=null;Object.values(room.players).forEach(p=>{p.score=0;p.filled=0;p.placed=false});broadcast()}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
$('hostBtn').addEventListener('click',createHost);$('joinBtn').addEventListener('click',joinRoom);$('startBtn').addEventListener('click',startGame);
$('leaveBtn').addEventListener('click',()=>{destroyPeer();show('home')});$('exitGameBtn').addEventListener('click',()=>{destroyPeer();show('home')});$('newGameBtn').addEventListener('click',newRound);
$('codeInput').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5));
$('board').addEventListener('click',e=>{const b=e.target.closest('[data-cell]');if(b)place(Number(b.dataset.cell))});
$('diceBtn').addEventListener('click',()=>{audioReady();rollDice()});$('undoBtn').addEventListener('click',undoLastMove);$('hostBtn').addEventListener('pointerdown',audioReady,{once:true});$('joinBtn').addEventListener('pointerdown',audioReady,{once:true});
const saved=localStorage.getItem('knister-name');if(saved)$('nameInput').value=saved;
window.addEventListener('beforeunload',()=>{try{if(peer)peer.destroy()}catch(e){}});
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}

let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',event=>{
 event.preventDefault();deferredInstallPrompt=event;
 if($('installBtn'))$('installBtn').classList.remove('hide');
});
if($('installBtn'))$('installBtn').addEventListener('click',async()=>{
 if(!deferredInstallPrompt)return;
 deferredInstallPrompt.prompt();
 try{await deferredInstallPrompt.userChoice}catch(e){}
 deferredInstallPrompt=null;$('installBtn').classList.add('hide');
});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;if($('installBtn'))$('installBtn').classList.add('hide')});
