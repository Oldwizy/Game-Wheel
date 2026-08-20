const CLIENT_ID='2xy2z7so34qc9k5i7kvf1e16upnusz';
const TOKEN_KEY='twitch_token_v1';
const REWARD_TITLE='рандом ігор';

export function createTwitchIntegration(root,{onGameRedeemed=()=>{},fetch:fetchFn=globalThis.fetch,WebSocketClass=globalThis.WebSocket,location:loc=globalThis.location??{},history:browserHistory=globalThis.history??{},storage=globalThis.localStorage,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  const get=id=>root.getElementById?.(id)??root.querySelector?.(`#${id}`); let socket=null,reconnect=null,broadcasterId=null,destroyed=false;
  const token=()=>{try{return JSON.parse(storage.getItem(TOKEN_KEY))?.token??null}catch{return null}};
  const clear=()=>{try{storage.removeItem(TOKEN_KEY)}catch{}}
  const rewardStatus=(text,cls='')=>{const el=get('twitchRewardStatus');if(el){el.textContent=text;el.className=`twitch-reward-status ${cls}`;}};
  async function api(path,access,options={}){const response=await fetchFn(`https://api.twitch.tv/helix/${path}`,{...options,headers:{'Client-Id':CLIENT_ID,Authorization:`Bearer ${access}`,'Content-Type':'application/json'}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||`Twitch API error (${response.status})`);return data;}
  function render(info){const out=get('twitchLoggedOut'),inside=get('twitchLoggedIn');if(out)out.style.display=info?'none':'';if(inside)inside.style.display=info?'':'none';if(info&&get('twitchUserName'))get('twitchUserName').textContent=info.login;}
  function connect(access){socket=new WebSocketClass('wss://eventsub.wss.twitch.tv/ws');socket.onmessage=async message=>{const data=JSON.parse(message.data);if(data.metadata?.message_type==='notification'){const event=data.payload.event;if(event.reward?.title===REWARD_TITLE&&event.user_input?.trim()){onGameRedeemed(event.user_input.trim(),event.user_name);api(`channel_points/custom_rewards/redemptions?broadcaster_id=${broadcasterId}&reward_id=${event.reward.id}&id=${event.id}`,access,{method:'PATCH',body:JSON.stringify({status:'FULFILLED'})}).catch(()=>{});}}};socket.onclose=()=>{if(!destroyed)reconnect=setTimer(()=>connect(access),5000);};}
  async function init(){const fresh=new URLSearchParams(loc.hash?.slice(1)).get('access_token');if(fresh){storage.setItem(TOKEN_KEY,JSON.stringify({token:fresh,savedAt:Date.now()}));browserHistory.replaceState(null,'',loc.pathname+loc.search);}const access=token();if(!access){render(null);return;}try{const response=await fetchFn('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:`OAuth ${access}`}});if(!response.ok){clear();render(null);return;}const info=await response.json();broadcasterId=info.user_id;render(info);}catch(error){rewardStatus(`Помилка Twitch: ${error.message}`,'error');}}
  function login(){const redirect=loc.origin+loc.pathname.replace(/[^/]*$/,'index.html');loc.href=`https://id.twitch.tv/oauth2/authorize?${new URLSearchParams({client_id:CLIENT_ID,redirect_uri:redirect,response_type:'token',scope:'channel:manage:redemptions channel:read:redemptions',force_verify:'true'})}`;}
  function logout(){clear();render(null);destroy();}
  get('twitchLoginBtn')?.addEventListener('click',login);get('twitchLogoutBtn')?.addEventListener('click',logout);
  return{init,login,logout,connect,destroy(){destroyed=true;if(reconnect!==null){clearTimer(reconnect);reconnect=null;}if(socket){socket.onclose=null;socket.close();socket=null;}}};
}
