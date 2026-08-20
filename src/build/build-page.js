import { addHistorySnapshot, createDefaultState, loadHistory, loadState, saveState } from '../core/state.js';
import { changeCopies } from '../core/game-rules.js';
import { normalizeName } from '../shared/presentation.js';
import { createGameListView } from './game-list-view.js';
import { createTwitchIntegration } from '../integrations/twitch.js';

const id = value => document.getElementById(value);
const ui = { input:id('gameInput'), copies:id('copiesInput'), add:id('addBtn'), clear:id('clearBtn'), reset:id('resetAllBtn'), lock:id('lockBtn'), tickets:id('tickets'), empty:id('emptyNote'), historyBlock:id('historyBlock'), historyList:id('historyList'), storage:id('storageStatus') };
let { value: state } = loadState(localStorage);
let history = loadHistory(localStorage).value;
const view = createGameListView(ui, { onRemove: remove, onCopyDelta: copies, onLoadHistory: loadArchived });

function persist() { const result = saveState(localStorage, state); ui.storage.hidden = !result.error; ui.storage.textContent = result.error ? 'Не вдалося зберегти зміни.' : ''; }
function render() { view.render(state, history); }
function addGame(rawName, count = 1, addedBy = null) {
  const name = normalizeName(rawName); count = Math.max(1, Number.parseInt(count, 10) || 1); if (!name) return;
  const existing = state.games.find(game => normalizeName(game.name).toLowerCase() === name.toLowerCase());
  state = existing ? { ...state, games: changeCopies(state.games, existing.id, count) } : { ...state, nextId: state.nextId + 1, games: [...state.games, { id: state.nextId, name, copies: count, addedBy }] };
  persist(); render();
}
function remove(gameId) { state = { ...state, games: state.games.filter(game => game.id !== gameId) }; persist(); render(); }
function copies(gameId, delta) { const game=state.games.find(g=>g.id===gameId); if (!game || game.copies + delta < 1) return; state={...state,games:changeCopies(state.games,gameId,delta)}; persist(); render(); }
function archive() { addHistorySnapshot(localStorage, state.games); history = loadHistory(localStorage).value; }
function loadArchived(entryId) { const entry=history.find(item=>item.id===entryId); if (!entry || (state.games.length && !confirm('Замінити поточний список збереженим? Поточний список ігор буде втрачено.'))) return; const games=entry.games.map(game=>({id:state.nextId++,name:game.name,copies:game.copies})); state={...state,games}; persist(); render(); }
ui.add.addEventListener('click',()=>{addGame(ui.input.value,ui.copies.value);ui.input.value='';ui.copies.value='1';ui.input.focus();});
[ui.input,ui.copies].forEach(input=>input.addEventListener('keydown',event=>{if(event.key==='Enter')ui.add.click();}));
ui.clear.addEventListener('click',()=>{if(!state.games.length)return;archive();state={...state,games:[]};persist();render();});
ui.reset.addEventListener('click',()=>{if(!confirm('Скинути все і почати заново? Поточний список та прогрес розіграшу будуть очищені.'))return;archive();state=createDefaultState();persist();render();});
ui.lock.addEventListener('click',()=>{if(state.games.length<2)return;archive();state={...state,roundCount:0,logEntries:[]};persist();location.href='draw.html';});
const twitch=createTwitchIntegration(document,{onGameRedeemed:(name,user)=>addGame(name,1,user)}); twitch.init();
window.addEventListener('pagehide',()=>{view.destroy();twitch.destroy();},{once:true}); render();
