// Local HTML viewers may deny storage; playing must remain available.
const deviceStorage={getItem(key){try{return window.localStorage.getItem(key)}catch{return null}},setItem(key,value){try{window.localStorage.setItem(key,value)}catch{}}};
'use strict';
const $=id=>document.getElementById(id);
const screens=['home','lobby','game'];
let peer=null, hostConn=null, role=null, roomCode='', myName='', myPeerId='', phase='home';
let conns=new Map();
let signalReady=false,guestJoined=false,retryTimer=null,joinTimer=null,retryCount=0,sessionVersion=0;
const departureTimers=new Map();
let room={phase:'lobby',roundId:0,turn:0,currentRoll:null,dice:[1,1],players:{},rollerId:null,lastAdvancedTurn:0};
let isRolling=false;
let myBoard=Array(25).fill(null), myPlaced=false, lastPlacedIndex=null;
const lines=[[0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24],[0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],[0,6,12,18,24],[20,16,12,8,4]];
function show(id){document.body.dataset.screen=id;if(id==='lobby')updateInvitation();if(id!=='game')dice3d?.hide();screens.forEach(s=>$(s).classList.toggle('active',s===id));phase=id}
function safeName(s){return String(s||'').trim().replace(/\s+/g,' ').slice(0,20)}
function randomCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:5},()=>chars[Math.floor(Math.random()*chars.length)]).join('')}
function setNet(text,on=true){$('netText').textContent=text;$('netDot').classList.toggle('on',on)}
function msg(where,text,bad=false){const e=$(where);e.textContent=text;e.className='message'+(bad?' bad':'');e.classList.remove('hide')}
function hideMsg(where){$(where).classList.add('hide')}
function scoreLine(vals){if(vals.some(v=>v==null))return 0;const f={};vals.forEach(v=>f[v]=(f[v]||0)+1);const c=Object.values(f).sort((a,b)=>b-a),u=[...new Set(vals)].sort((a,b)=>a-b);if(c[0]===5)return 10;if(c[0]===4)return 6;if(c[0]===3&&c[1]===2)return 8;if(c[0]===3)return 3;if(c[0]===2&&c[1]===2)return 3;if(c[0]===2)return 1;if(u.length===5&&u[4]-u[0]===4)return u.includes(7)?8:12;return 0}
function score(board){const x=lines.map((a,i)=>scoreLine(a.map(k=>board[k]))*(i>=10?2:1));return{rows:x.slice(0,5).reduce((a,b)=>a+b,0),cols:x.slice(5,10).reduce((a,b)=>a+b,0),diag:x.slice(10).reduce((a,b)=>a+b,0),total:x.reduce((a,b)=>a+b,0)}}
function rollOrder(){return Object.values(room.players)}
function ensureRoller(){const order=rollOrder();if(!order.length){room.rollerId=null;return}if(!order.some(p=>p.id===room.rollerId))room.rollerId=order[0].id}
function advanceRoller(){
 const order=rollOrder();if(!order.length){room.rollerId=null;return}
 const i=Math.max(0,order.findIndex(p=>p.id===room.rollerId));room.rollerId=order[(i+1)%order.length].id
}
function maybeAdvanceRoller(){
 const players=rollOrder(),all=players.length>0&&players.every(p=>p.placed);
 if(room.phase==='game'&&room.turn>0&&all&&room.lastAdvancedTurn<room.turn){advanceRoller();room.lastAdvancedTurn=room.turn}
}
function playerSummary(){return Object.values(room.players).map(p=>({id:p.id,name:p.name,score:p.score||0,filled:p.filled||0,placed:!!p.placed,host:!!p.host})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name))}
function hostPayload(){return{type:'state',phase:room.phase,roundId:room.roundId,turn:room.turn,currentRoll:room.currentRoll,dice:room.dice,rollerId:room.rollerId,players:playerSummary()}}
function broadcast(){if(role==='host'&&room.phase==='game'&&room.turn>=25&&Object.values(room.players).length&&Object.values(room.players).every(p=>p.placed)){room.phase='finished';room.currentRoll=null}const p=hostPayload();conns.forEach(c=>{if(c.open)try{c.send(p)}catch(e){}});renderFromRoom()}
function setupConn(conn){
 conn.on('data',data=>handleHostData(conn,data));
 conn.on('close',()=>{
   if(conns.get(conn.peer)!==conn)return;conns.delete(conn.peer);
   const version=sessionVersion;clearTimeout(departureTimers.get(conn.peer));
   departureTimers.set(conn.peer,setTimeout(()=>{departureTimers.delete(conn.peer);if(version!==sessionVersion||conns.has(conn.peer))return;if(room.players[conn.peer]){delete room.players[conn.peer];ensureRoller();broadcast()}},45000));
 });
 conn.on('error',()=>{});
}
function handleHostData(conn,d){
 if(!d||typeof d!=='object')return;
 if(d.type==='join'){
   if(room.phase!=='lobby'&&!room.players[conn.peer]){conn.send({type:'error',message:'Dieses Spiel läuft bereits.'});setTimeout(()=>conn.close(),300);return}
   const n=safeName(d.name)||'Spieler';
   clearTimeout(departureTimers.get(conn.peer));departureTimers.delete(conn.peer);
   if(!room.players[conn.peer])room.players[conn.peer]={id:conn.peer,name:n,score:0,filled:0,placed:false,host:false};
   conns.set(conn.peer,conn);conn.send(hostPayload());broadcast();return;
 }
 const p=room.players[conn.peer]; if(!p)return;
 if(d.roundId!==undefined&&d.roundId!==room.roundId)return;
 if(d.type==='roll'&&d.turn===room.turn&&canRollNow(conn.peer)){beginHostRoll();return}
 if(d.type==='placed'&&room.phase==='game'&&d.turn===room.turn&&!p.placed&&Array.isArray(d.board)&&d.board.length===25){
   const valid=d.board.every(v=>v===null||(Number.isInteger(v)&&v>=2&&v<=12));if(!valid)return;
   const filled=d.board.filter(v=>v!==null).length;if(filled!==room.turn)return;
   const sc=score(d.board);p.score=sc.total;p.filled=filled;p.placed=true;maybeAdvanceRoller();broadcast();return;
 }
 if(d.type==='undo'&&room.phase==='game'&&!isRolling&&d.turn===room.turn&&p.placed&&Array.isArray(d.board)&&d.board.length===25){
   const valid=d.board.every(v=>v===null||(Number.isInteger(v)&&v>=2&&v<=12));if(!valid)return;
   const filled=d.board.filter(v=>v!==null).length;if(filled!==room.turn-1)return;
   const sc=score(d.board);p.score=sc.total;p.filled=filled;p.placed=false;broadcast();
 }
}
function destroyPeer(){sessionVersion++;clearTimeout(retryTimer);clearTimeout(joinTimer);retryTimer=joinTimer=null;departureTimers.forEach(clearTimeout);departureTimers.clear();signalReady=false;guestJoined=false;retryCount=0;const oldPeer=peer,oldConns=[...conns.values()];peer=null;conns.clear();isRolling=false;dice3d?.hide();try{if(hostConn)hostConn.close()}catch(e){};try{oldConns.forEach(c=>c.close())}catch(e){};try{if(oldPeer)oldPeer.destroy()}catch(e){};peer=null;hostConn=null;conns.clear();role=null;roomCode='';myPeerId='';room={phase:'lobby',roundId:0,turn:0,currentRoll:null,dice:[1,1],players:{},rollerId:null,lastAdvancedTurn:0};myBoard=Array(25).fill(null);myPlaced=false;lastPlacedIndex=null;setNet('Bereit',false)}
function getName(){const n=safeName($('nameInput').value);if(!n){$('nameInput').focus();return null}deviceStorage.setItem('wuerfelblatt-name',n);return n}
function connectionNotice(text){setNet('Verbinde erneut …',false);msg(phase==='game'?'gameMsg':'lobbyMsg',text);if(phase==='lobby')renderLobby();}
function scheduleReconnect(text){
 connectionNotice(text);if(retryTimer||!role)return;
 if(retryCount>=12){setNet('Nicht verbunden',false);msg(phase==='game'?'gameMsg':'lobbyMsg','Die Verbindung konnte nicht hergestellt werden. Internet prüfen und „Erneut verbinden“ tippen.',true);return}
 const version=sessionVersion;retryTimer=setTimeout(()=>{retryTimer=null;if(version!==sessionVersion)return;retryCount++;recoverConnection()},Math.min(1500+retryCount*700,5000));
}
function recoverConnection(){
 if(!role)return;
 if(navigator.onLine===false){scheduleReconnect('Kein Internet. Die Verbindung wird automatisch erneut versucht.');return}
 if(!peer||peer.destroyed){openPeer();return}
 if(peer.disconnected){try{peer.reconnect()}catch{}scheduleReconnect('Der Raum wird unter demselben Code wieder verbunden.');return}
 if(!signalReady){scheduleReconnect('Die Verbindung zum Raum wird wiederhergestellt.');return}
 if(role==='guest'&&!guestJoined)connectToHost();
}
function openPeer(){
 const version=sessionVersion;
 const id=role==='host'?'wuerfelblatt-'+roomCode.toLowerCase():(myPeerId||undefined);
 const current=new Peer(id);peer=current;signalReady=false;
 const active=()=>version===sessionVersion&&peer===current;
 current.on('open',pid=>{
   if(!active())return;signalReady=true;clearTimeout(retryTimer);retryTimer=null;retryCount=0;myPeerId=pid;
   if(role==='host'){
     if(!room.players[pid])room.players[pid]={id:pid,name:myName,score:0,filled:0,placed:false,host:true};
     setNet('Online');hideMsg('lobbyMsg');hideMsg('gameMsg');if(phase==='home')show('lobby');renderFromRoom();
   }else connectToHost();
 });
 current.on('connection',conn=>{if(active()&&role==='host')setupConn(conn)});
 current.on('disconnected',()=>{if(!active())return;signalReady=false;scheduleReconnect('Verbindung unterbrochen. Bitte ZAPPO geöffnet lassen – der Raum wird wieder verbunden.');});
 current.on('error',err=>{
   if(!active())return;
   if(err.type==='unavailable-id'&&role==='host'&&!room.players[myPeerId]){current.destroy();roomCode=randomCode();openPeer();return}
   if(err.type==='peer-unavailable'&&role==='guest'){guestJoined=false;clearTimeout(joinTimer);joinTimer=null;const old=hostConn;hostConn=null;try{old?.close()}catch{}scheduleReconnect('Der Spielleiter ist noch nicht erreichbar. Er muss nach WhatsApp zu ZAPPO zurückkehren. Wir versuchen es erneut.');return}
   signalReady=false;scheduleReconnect('Online-Verbindung unterbrochen. Sie wird automatisch wiederhergestellt.');
 });
 current.on('close',()=>{if(active()){signalReady=false;scheduleReconnect('Verbindung geschlossen. Der Raum wird erneut verbunden.')}});
}
function connectToHost(){
 if(role!=='guest'||!signalReady||!peer||guestJoined||joinTimer)return;
 const current=peer,version=sessionVersion;const previous=hostConn;hostConn=null;try{previous?.close()}catch{}
 const conn=current.connect('wuerfelblatt-'+roomCode.toLowerCase(),{reliable:true});hostConn=conn;
 const active=()=>version===sessionVersion&&peer===current&&hostConn===conn;
 connectionNotice('Beitritt läuft … Bitte warten, bis der Spielleiter wieder in ZAPPO ist.');
 joinTimer=setTimeout(()=>{joinTimer=null;if(!active()||guestJoined)return;hostConn=null;try{conn.close()}catch{}scheduleReconnect('Der Spielleiter ist noch nicht erreichbar. Der Beitritt wird erneut versucht.');},10000);
 conn.on('open',()=>{if(active())conn.send({type:'join',name:myName})});
 conn.on('data',d=>{
   if(!active())return;
   if(d?.type==='state'){guestJoined=true;retryCount=0;clearTimeout(joinTimer);clearTimeout(retryTimer);joinTimer=retryTimer=null;setNet('Online');hideMsg('lobbyMsg');hideMsg('gameMsg')}
   if(d?.type==='error'){clearTimeout(joinTimer);clearTimeout(retryTimer);joinTimer=retryTimer=null;hostConn=null;guestJoined=false;conn.close();setNet('Beitritt nicht möglich',false)}
   handleGuestData(d);
 });
 const lost=()=>{if(!active())return;guestJoined=false;clearTimeout(joinTimer);joinTimer=null;hostConn=null;scheduleReconnect('Verbindung zum Spielleiter unterbrochen. Wir versuchen es erneut.');};
 conn.on('close',lost);conn.on('error',lost);
}
function createHost(){
 myName=getName();if(!myName)return;destroyPeer();role='host';roomCode=randomCode();show('lobby');connectionNotice('Spielraum wird verbunden …');openPeer();
}
function joinRoom(){
 myName=getName();if(!myName)return;const code=$('codeInput').value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');if(code.length!==5){$('codeInput').focus();return}
 destroyPeer();role='guest';roomCode=code;show('lobby');connectionNotice('Verbindung zum Spielleiter wird hergestellt …');openPeer();
}
function resumeConnection(){if(!role||document.visibilityState==='hidden')return;clearTimeout(retryTimer);retryTimer=null;retryCount=0;recoverConnection()}
window.addEventListener('online',resumeConnection);window.addEventListener('pageshow',resumeConnection);document.addEventListener('visibilitychange',resumeConnection);
function resetRoundView(){
 dice3d?.hide();isRolling=false;myBoard=Array(25).fill(null);myPlaced=false;lastPlacedIndex=null;
 $('ceremony').classList.add('hide');$('ceremony').dataset.round='';$('winnerBox').classList.add('hide');
}
function handleGuestData(d){
 if(!d||typeof d!=='object')return;if(d.type==='error'){msg('lobbyMsg',d.message||'Beitritt nicht möglich.',true);return}
 if(d.type==='state'){
   if(Number.isInteger(d.roundId)&&d.roundId<(room.roundId||0))return;
   const changedRound=Number.isInteger(d.roundId)&&d.roundId!==(room.roundId||0);
   const restart=d.phase==='game'&&(changedRound||room.phase!=='game'||d.turn<room.turn);
   const prevTurn=restart?0:room.turn;
   if(restart)resetRoundView();
   room.phase=d.phase;room.roundId=d.roundId??room.roundId??0;room.turn=d.turn;room.currentRoll=d.currentRoll;
   room.dice=Array.isArray(d.dice)?d.dice:[1,1];room.rollerId=d.rollerId||null;room.players={};(d.players||[]).forEach(p=>room.players[p.id]=p);
   if(room.phase==='game'&&phase!=='game')show('game');
   const me=room.players[myPeerId];if(me)myPlaced=!!me.placed;
   if(d.turn>prevTurn&&d.currentRoll!=null){lastPlacedIndex=null;animateDice(room.dice[0],room.dice[1],false)}
   renderFromRoom();
 }
}
function renderLobby(){
 $('startBtn').classList.toggle('hide',role!=='host');$('startBtn').disabled=role!=='host'||!signalReady||Object.keys(room.players).length<1;$('roomCode').textContent=roomCode||'-----';updateInvitation();
 const ps=playerSummary();$('playerCount').textContent=ps.length+' '+(ps.length===1?'Spieler':'Spieler');
 $('lobbyPlayers').innerHTML=ps.map(p=>`<div class="player"><div class="avatar">${escapeHtml(p.name.slice(0,1).toUpperCase())}</div><div class="pinfo"><b>${escapeHtml(p.name)} ${p.id===myPeerId?'· du':''}</b><small>${p.host?'Spielleiter':'bereit'}</small></div></div>`).join('')||'<div class="mini">Verbindung zum Spielleiter wird hergestellt …</div>';
}
function startGame(){
 if(role!=='host')return;resetRoundView();room.roundId=(room.roundId||0)+1;room.phase='game';room.turn=0;room.currentRoll=null;room.dice=[1,1];room.rollerId=rollOrder()[0]?.id||null;room.lastAdvancedTurn=0;myBoard=Array(25).fill(null);myPlaced=false;lastPlacedIndex=null;Object.values(room.players).forEach(p=>{p.score=0;p.filled=0;p.placed=false});show('game');broadcast()
}
function renderBoard(){
 const sc=score(myBoard);$('sRows').textContent=sc.rows;$('sCols').textContent=sc.cols;$('sDiag').textContent=sc.diag;$('sTotal').textContent=sc.total;
 $('progress').style.width=(myBoard.filter(v=>v!==null).length*4)+'%';
 $('board').innerHTML=myBoard.map((v,i)=>`<button class="cell ${(Math.floor(i/5)===i%5||Math.floor(i/5)+i%5===4)?'diag':''} ${v===null&&room.currentRoll!==null&&!myPlaced?'ready':''}" data-cell="${i}" ${v!==null||room.currentRoll===null||myPlaced||isRolling||room.phase!=='game'?'disabled':''}>${v==null?'·':v}</button>`).join('');
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
 $('gameName').textContent=myName;$('turnLabel').textContent='Wurf '+room.turn+' / 25';$('currentRoll').textContent=room.currentRoll==null?'–':room.currentRoll;
 const ps=playerSummary(),ready=ps.filter(p=>p.placed).length,all=ps.length>0&&ready===ps.length;
 $('readyCount').textContent=room.currentRoll==null?'':ready+' / '+ps.length+' platziert';
 $('standings').innerHTML=ps.map((p,i)=>`<div class="standing"><span>${1+ps.filter(other=>other.score>p.score).length}</span><div><b>${escapeHtml(p.name)}${p.id===myPeerId?' · du':''}</b><div class="${p.placed?'check':'wait'}">${room.currentRoll==null?'bereit':p.placed?'✓ platziert':'wartet …'}</div></div><span class="score">${p.score||0}</span></div>`).join('');
 const roller=Object.values(room.players).find(p=>p.id===room.rollerId),myTurn=room.rollerId===myPeerId;
 if($('rollerStatus')){$('rollerStatus').classList.toggle('mine',myTurn);$('rollerStatus').querySelector('b').textContent=room.phase==='finished'?'Runde abgeschlossen':myTurn?'Du bist mit Würfeln dran':(roller?roller.name+' würfelt':'Würfler wird bestimmt …')}
 $('hostControls').classList.toggle('hide',room.turn>=25||room.phase==='finished');
 if($('diceBtn')){const canNow=myTurn&&!isRolling&&room.turn<25&&(room.currentRoll===null||all);$('diceBtn').disabled=!canNow;const txt=$('diceBtn').querySelector('span:last-child');if(txt)txt.textContent='Würfeln';$('diceBtn').title=canNow?'Jetzt würfeln':isRolling?'Die Würfel rollen':!myTurn?(roller?.name||'Ein Mitspieler')+' ist dran':'Warte, bis alle eingetragen haben'}
 if($('undoBtn'))$('undoBtn').disabled=!myPlaced||lastPlacedIndex==null||isRolling||room.phase!=='game';
 if(room.phase==='finished')finishGame();else{$('winnerBox').classList.add('hide');$('newGameBtn').classList.add('hide')}
 $('turnHint').textContent=room.phase==='finished'?'Runde beendet.':isRolling?'Die Würfel rollen …':room.currentRoll==null?(myTurn?'Du eröffnest die Runde.':'Warte auf '+(roller?.name||'den Würfler')+'.'):(myPlaced?'Eingetragen – warte auf die anderen.':'Tippe ein freies Feld an.');
 $('hostHint').textContent=room.currentRoll!==null&&!all?'Noch '+(ps.length-ready)+' Spieler müssen platzieren.':'Alle bereit für den nächsten Wurf.';
 renderBoard();if(!isRolling)showSettledDice();
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
let dice3d=null;
function getDice3D(){
 if(!dice3d)dice3d=new window.ZappoDice(document.querySelector('.board-card'),$('board'),$('diceDock'));
 return dice3d;
}
function showSettledDice(){
 if(room.currentRoll==null){dice3d?.hide();return}
 getDice3D().show(room.dice?.[0]||1,room.dice?.[1]||1);
}
function animateDice(a,b,commit=true){
 isRolling=true;
 if(phase!=='game'){show('game');renderBoard()}
 const activeRoom=room,activeRound=room.roundId;
 audioReady();
 getDice3D().roll(a,b,{
  reduced:window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  onImpact:k=>{thud(0,[.13,.08,.045,.02][k],145-k*15);thud(.045,[.08,.05,.03,.015][k],130-k*12)},
  onDone:()=>{
   if(room!==activeRoom||room.roundId!==activeRound||room.phase!=='game')return;
   isRolling=false;
   if(commit){room.dice=[a,b];room.turn++;room.currentRoll=a+b;Object.values(room.players).forEach(p=>p.placed=false);myPlaced=false;lastPlacedIndex=null;broadcast()}
   else renderFromRoom();
  }
 });
}
function canRollNow(playerId){
 const ps=rollOrder(),all=ps.length>0&&ps.every(p=>p.placed);
 return role==='host'&&room.phase==='game'&&playerId===room.rollerId&&room.turn<25&&!isRolling&&(room.currentRoll===null||all)
}
function beginHostRoll(){
 if(role!=='host'||!canRollNow(room.rollerId))return;
 isRolling=true;renderFromRoom();
 const a=1+Math.floor(Math.random()*6),b=1+Math.floor(Math.random()*6);
 animateDice(a,b,true);
}
function rollDice(){
 if(room.phase!=='game'||room.rollerId!==myPeerId||room.turn>=25||isRolling)return;
 const ps=Object.values(room.players),all=ps.length>0&&ps.every(p=>p.placed);
 if(room.currentRoll!==null&&!all)return;
 if(role==='host')beginHostRoll();
 else if(hostConn&&hostConn.open){$('diceBtn').disabled=true;hostConn.send({type:'roll',roundId:room.roundId,turn:room.turn})}
}
function place(i){
 if(room.phase!=='game'||isRolling||myPlaced||room.currentRoll==null||myBoard[i]!=null)return;myBoard[i]=room.currentRoll;myPlaced=true;lastPlacedIndex=i;
 const sc=score(myBoard);
 if(role==='host'){const me=room.players[myPeerId];me.score=sc.total;me.filled=room.turn;me.placed=true;maybeAdvanceRoller();broadcast()}
 else if(hostConn&&hostConn.open){hostConn.send({type:'placed',roundId:room.roundId,turn:room.turn,board:myBoard})}
 renderBoard();renderFromRoom()
}
function undoLastMove(){
 if(room.phase!=='game'||isRolling||!myPlaced||lastPlacedIndex==null)return;
 myBoard[lastPlacedIndex]=null;lastPlacedIndex=null;myPlaced=false;
 const sc=score(myBoard);
 if(role==='host'){
  const me=room.players[myPeerId];if(me){me.score=sc.total;me.filled=Math.max(0,room.turn-1);me.placed=false}broadcast();
 }else if(hostConn&&hostConn.open){
  hostConn.send({type:'undo',roundId:room.roundId,turn:room.turn,board:myBoard});
 }
 renderBoard();renderFromRoom();
}
function finishGame(){
 const ps=playerSummary();if(!ps.length)return;const top=ps[0].score,w=ps.filter(p=>p.score===top),box=$('ceremony');
 const first=box.dataset.round!==String(room.roundId);box.dataset.round=String(room.roundId);
 $('ceremonyTitle').textContent=w.length>1?'Gemeinsam auf Platz 1!':w[0].id===myPeerId?'Du hast gewonnen!':'Der Sieg geht an …';
 $('championName').textContent=w.map(p=>p.name).join(' & ');$('championPoints').textContent=top+' Punkte';
 $('finalRanking').innerHTML=ps.map(p=>{const rank=1+ps.filter(other=>other.score>p.score).length;return `<li class="${rank===1?'gold':''}"><span class="medal">${rank===1?'★':rank}</span><b>${escapeHtml(p.name)}${p.id===myPeerId?' · du':''}</b><span>${p.score}<small>Punkte</small></span></li>`}).join('');
 $('ceremonyWait').textContent=role==='host'?'Alle bleiben im Raum. Bereit für die Revanche?':'Warte auf die nächste Runde vom Spielleiter.';
 box.classList.remove('hide');$('newGameBtn').classList.toggle('hide',role!=='host');$('winnerBox').classList.add('hide');$('hostControls').classList.add('hide');
 if(first){box.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});$('ceremonyTitle').focus({preventScroll:true})}
}
function newRound(){if(role!=='host'||room.phase!=='finished')return;startGame();document.querySelector('.board-card').scrollIntoView({block:'start'})}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
$('hostBtn').addEventListener('click',createHost);$('joinBtn').addEventListener('click',joinRoom);$('startBtn').addEventListener('click',startGame);
$('leaveBtn').addEventListener('click',()=>{destroyPeer();show('home')});$('exitGameBtn').addEventListener('click',()=>{destroyPeer();show('home')});$('newGameBtn').addEventListener('click',newRound);
$('codeInput').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5));
$('board').addEventListener('click',e=>{const b=e.target.closest('[data-cell]');if(b)place(Number(b.dataset.cell))});
$('diceBtn').addEventListener('click',()=>{audioReady();rollDice()});$('undoBtn').addEventListener('click',undoLastMove);$('hostBtn').addEventListener('pointerdown',audioReady,{once:true});$('joinBtn').addEventListener('pointerdown',audioReady,{once:true});
const saved=deviceStorage.getItem('wuerfelblatt-name');if(saved)$('nameInput').value=saved;
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

const allowedThemes=['classic','space','nature'];
function applyTheme(theme){
 if(!allowedThemes.includes(theme))theme='classic';
 document.body.dataset.theme=theme;deviceStorage.setItem('wuerfelblatt-theme',theme);
 document.querySelectorAll('[data-theme-choice]').forEach(btn=>btn.classList.toggle('selected',btn.dataset.themeChoice===theme));
}
function openThemeSettings(){$('themeModal').classList.remove('hide');document.body.classList.add('modal-open')}
function closeThemeSettings(){$('themeModal').classList.add('hide');document.body.classList.remove('modal-open')}
$('settingsBtn').addEventListener('click',openThemeSettings);
$('closeThemeBtn').addEventListener('click',closeThemeSettings);
$('themeModal').addEventListener('click',event=>{if(event.target===$('themeModal'))closeThemeSettings()});
document.querySelectorAll('[data-theme-choice]').forEach(btn=>btn.addEventListener('click',()=>{applyTheme(btn.dataset.themeChoice);setTimeout(closeThemeSettings,180)}));
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeThemeSettings()});
applyTheme(deviceStorage.getItem('wuerfelblatt-theme')||'classic');
window.addEventListener('resize',()=>{if(phase==='game'&&!isRolling)showSettledDice()});

function invitationText(){
 const url=new URL(location.protocol==='https:'||location.protocol==='http:'?location.href:'https://ismacoff.github.io/knister/zappo/');
 url.search='';url.hash='';url.searchParams.set('code',roomCode);
 return `Spiel mit mir ZAPPO! 🎲\n${url.href}\n\nRaumcode: ${roomCode}\nLink öffnen, Namen eingeben und beitreten.`;
}
function updateInvitation(){
 const valid=/^[A-Z0-9]{5}$/.test(roomCode)&&(role==='host'?signalReady:guestJoined);$('copyInviteBtn').disabled=!valid;
 const link=$('whatsappInvite');link.setAttribute('aria-disabled',String(!valid));
 if(valid)link.href='https://wa.me/?text='+encodeURIComponent(invitationText());else link.removeAttribute('href');
 $('inviteStatus').textContent='';$('inviteFallback').classList.add('hide');
}
$('copyInviteBtn').addEventListener('click',async()=>{
 if($('copyInviteBtn').disabled||!/^[A-Z0-9]{5}$/.test(roomCode))return;
 const text=invitationText();let copied=false;
 try{await navigator.clipboard.writeText(text);copied=true}catch{}
 if(!copied){const field=$('inviteFallback');field.value=text;field.classList.remove('hide');field.focus();field.select();field.setSelectionRange(0,text.length);try{copied=document.execCommand('copy')}catch{}if(copied)field.classList.add('hide')}
 $('inviteStatus').textContent=copied?'Einladung mit Link und Code kopiert.':'Bitte den markierten Einladungstext kopieren.';
});
const invitationCode=new URLSearchParams(location.search).get('code')?.trim().toUpperCase();
if(invitationCode&&/^[A-Z0-9]{5}$/.test(invitationCode)){$('codeInput').value=invitationCode;$('codeInput').closest('.join-row').scrollIntoView({block:'center'});}

$('retryConnectionBtn').addEventListener('click',resumeConnection);
