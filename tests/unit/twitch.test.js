import { expect, test, vi } from 'vitest';
import { createTwitchIntegration } from '../../src/integrations/twitch.js';

function root(){const values=new Map();return{element(id){if(!values.has(id))values.set(id,{style:{},className:'',textContent:'',addEventListener:vi.fn()});return values.get(id);},getElementById(id){return this.element(id);}};}
function storage(token='token'){const values=new Map(token?[['twitch_token_v1',JSON.stringify({token})]]:[]);return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:vi.fn(key=>values.delete(key))};}

test('invalid validation clears the saved token',async()=>{const saved=storage();const integration=createTwitchIntegration(root(),{storage:saved,fetch:vi.fn().mockResolvedValue({ok:false}),location:{hash:'',origin:'x',pathname:'/index.html',search:''},history:{}});await integration.init();expect(saved.removeItem).toHaveBeenCalledWith('twitch_token_v1');});

test('API failure updates reward status without adding a game',async()=>{const ui=root(),add=vi.fn();const integration=createTwitchIntegration(ui,{storage:storage(),onGameRedeemed:add,fetch:vi.fn().mockRejectedValue(new Error('offline')),location:{hash:'',origin:'x',pathname:'/index.html',search:''},history:{}});await integration.init();expect(ui.element('twitchRewardStatus').textContent).toContain('offline');expect(add).not.toHaveBeenCalled();});

test('matching redemption is delivered once',()=>{let socket;class FakeSocket{constructor(){socket=this;}close(){}}const add=vi.fn();const integration=createTwitchIntegration(root(),{onGameRedeemed:add,WebSocketClass:FakeSocket,storage:storage(null)});integration.connect('token');socket.onmessage({data:JSON.stringify({metadata:{message_type:'notification'},payload:{event:{reward:{title:'рандом ігор',id:'r'},user_input:' Alpha ',user_name:'viewer',id:'e'}}})});expect(add).toHaveBeenCalledOnce();expect(add).toHaveBeenCalledWith('Alpha','viewer');integration.destroy();});

test('destroy closes socket and clears one reconnect timer',()=>{let socket;class FakeSocket{constructor(){socket=this;}close=vi.fn()}const clearTimer=vi.fn(),integration=createTwitchIntegration(root(),{WebSocketClass:FakeSocket,storage:storage(null),setTimer:vi.fn(()=>7),clearTimer});integration.connect('token');socket.onclose();integration.destroy();expect(clearTimer).toHaveBeenCalledOnce();expect(clearTimer).toHaveBeenCalledWith(7);expect(socket.close).toHaveBeenCalledOnce();});
