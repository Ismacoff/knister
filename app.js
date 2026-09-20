'use strict';
const $=id=>document.getElementById(id);
const screens=['home','lobby','game'];
let peer=null, hostConn=null, role=null, roomCode='', myName='', myPeerId='', phase='home';
let conns=new Map();
let room={phase:'lobby',turn:0,currentRoll:null,dice:[1,1],players:{}};
let isRolling=false;
let myBoard=Array(25).fill(null), myPlaced=false;
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
   const sc=score(d.board);p.score=sc.total;p.filled=filled;p.placed=true;broadcast();
 }
}
function destroyPeer(){try{if(hostConn)hostConn.close()}catch(e){};try{conns.forEach(c=>c.close())}catch(e){};try{if(peer)peer.destroy()}catch(e){};peer=null;hostConn=null;conns.clear();role=null;roomCode='';myPeerId='';room={phase:'lobby',turn:0,currentRoll:null,dice:[1,1],players:{}};myBoard=Array(25).fill(null);myPlaced=false;setNet('Bereit',false)}
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
 if(d.type==='state'){const prevTurn=room.turn;room.phase=d.phase;room.turn=d.turn;room.currentRoll=d.currentRoll;room.dice=Array.isArray(d.dice)?d.dice:[1,1];room.players={};(d.players||[]).forEach(p=>room.players[p.id]=p);if(d.turn>prevTurn&&d.currentRoll!=null)animateDice(room.dice[0],room.dice[1],false);
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
 if(role!=='host')return;room.phase='game';room.turn=0;room.currentRoll=null;room.dice=[1,1];myBoard=Array(25).fill(null);myPlaced=false;Object.values(room.players).forEach(p=>{p.score=0;p.filled=0;p.placed=false});show('game');broadcast()
}
function renderBoard(){
 const sc=score(myBoard);$('sRows').textContent=sc.rows;$('sCols').textContent=sc.cols;$('sDiag').textContent=sc.diag;$('sTotal').textContent=sc.total;
 $('progress').style.width=(myBoard.filter(v=>v!==null).length*4)+'%';
 $('board').innerHTML=myBoard.map((v,i)=>`<button class="cell ${(Math.floor(i/5)===i%5||Math.floor(i/5)+i%5===4)?'diag':''} ${v===null&&room.currentRoll!==null&&!myPlaced?'ready':''}" data-cell="${i}" ${v!==null||room.currentRoll===null||myPlaced||room.phase!=='game'?'disabled':''}>${v==null?'·':v}</button>`).join('');
}
function renderFromRoom(){
 if(room.phase==='lobby'){renderLobby();return}
 $('gameName').textContent=myName;$('turnLabel').textContent='Wurf '+room.turn+' / 25';$('currentRoll').textContent=room.currentRoll==null?'–':room.currentRoll;setDie($('die1'),room.dice?.[0]||1);setDie($('die2'),room.dice?.[1]||1);
 const ps=playerSummary(),ready=ps.filter(p=>p.placed).length,all=ps.length>0&&ready===ps.length;
 $('readyCount').textContent=room.currentRoll==null?'':ready+' / '+ps.length+' platziert';
 $('standings').innerHTML=ps.map((p,i)=>`<div class="standing"><span>${i+1}</span><div><b>${escapeHtml(p.name)}${p.id===myPeerId?' · du':''}</b><div class="${p.placed?'check':'wait'}">${room.currentRoll==null?'bereit':p.placed?'✓ platziert':'wartet …'}</div></div><span class="score">${p.score||0}</span></div>`).join('');
 $('hostControls').classList.toggle('hide',role!=='host'||room.turn>=25);if($('diceBtn'))$('diceBtn').disabled=role!=='host'||isRolling||(room.currentRoll!==null&&!all)||room.turn>=25;
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
function setDie(el,value){if(!el)return;value=Math.max(1,Math.min(6,Number(value)||1));el.dataset.value=String(value);el.setAttribute('aria-label','Würfel zeigt '+value)}
function orientCube(el,value){if(!el)return;const m={1:'rotateX(-8deg) rotateY(10deg)',2:'rotateX(-98deg) rotateY(4deg)',3:'rotateX(-8deg) rotateY(-82deg)',4:'rotateX(-8deg) rotateY(98deg)',5:'rotateX(98deg) rotateY(3deg)',6:'rotateX(-8deg) rotateY(188deg)'};el.style.transform=m[value]||m[1]}
function animateDice(a,b,commit=true){
 const d1=$('die1'),d2=$('die2'),r1=$('rollDie1'),r2=$('rollDie2'),overlay=$('boardDiceOverlay');if(!d1||!d2||!r1||!r2||!overlay)return;
 diceSound();overlay.classList.remove('show');void overlay.offsetWidth;overlay.classList.add('show');
 let ticks=0;const timer=setInterval(()=>{setDie(d1,1+Math.floor(Math.random()*6));setDie(d2,1+Math.floor(Math.random()*6));if(++ticks>=10)clearInterval(timer)},120);
 setTimeout(()=>{clearInterval(timer);setDie(d1,a);setDie(d2,b);orientCube(r1,a);orientCube(r2,b)},1320);
 setTimeout(()=>{overlay.classList.remove('show');if(commit){room.dice=[a,b];room.turn++;room.currentRoll=a+b;Object.values(room.players).forEach(p=>p.placed=false);myPlaced=false;isRolling=false;broadcast()}},1760);
}
function rollDice(){
 if(role!=='host'||room.turn>=25||isRolling)return;const ps=playerSummary(),all=ps.length>0&&ps.every(p=>p.placed);if(room.currentRoll!==null&&!all)return;
 isRolling=true;renderFromRoom();const a=1+Math.floor(Math.random()*6),b=1+Math.floor(Math.random()*6);animateDice(a,b,true)
}
function place(i){
 if(room.phase!=='game'||myPlaced||room.currentRoll==null||myBoard[i]!=null)return;myBoard[i]=room.currentRoll;myPlaced=true;
 const sc=score(myBoard);
 if(role==='host'){const me=room.players[myPeerId];me.score=sc.total;me.filled=room.turn;me.placed=true;broadcast()}
 else if(hostConn&&hostConn.open){hostConn.send({type:'placed',turn:room.turn,board:myBoard})}
 renderBoard();renderFromRoom()
}
function finishGame(){
 const ps=playerSummary();if(!ps.length)return;const top=ps[0].score,w=ps.filter(p=>p.score===top);
 $('winnerBox').innerHTML=`<div class="label">Runde beendet</div><b>${escapeHtml(w.map(x=>x.name).join(' & '))}</b><div>${top} Punkte</div>`;$('winnerBox').classList.remove('hide');$('newGameBtn').classList.toggle('hide',role!=='host');$('hostControls').classList.add('hide');
 if(role==='host'&&room.phase!=='finished'){room.phase='finished';broadcast()}
}
function newRound(){if(role!=='host')return;$('winnerBox').classList.add('hide');$('newGameBtn').classList.add('hide');room.phase='game';room.turn=0;room.currentRoll=null;room.dice=[1,1];myBoard=Array(25).fill(null);myPlaced=false;Object.values(room.players).forEach(p=>{p.score=0;p.filled=0;p.placed=false});broadcast()}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
$('hostBtn').addEventListener('click',createHost);$('joinBtn').addEventListener('click',joinRoom);$('startBtn').addEventListener('click',startGame);
$('leaveBtn').addEventListener('click',()=>{destroyPeer();show('home')});$('exitGameBtn').addEventListener('click',()=>{destroyPeer();show('home')});$('newGameBtn').addEventListener('click',newRound);
$('codeInput').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5));
$('board').addEventListener('click',e=>{const b=e.target.closest('[data-cell]');if(b)place(Number(b.dataset.cell))});
$('diceBtn').addEventListener('click',()=>{audioReady();rollDice()});$('hostBtn').addEventListener('pointerdown',audioReady,{once:true});$('joinBtn').addEventListener('pointerdown',audioReady,{once:true});setDie($('die1'),1);setDie($('die2'),1);
const saved=localStorage.getItem('knister-name');if(saved)$('nameInput').value=saved;
window.addEventListener('beforeunload',()=>{try{if(peer)peer.destroy()}catch(e){}});