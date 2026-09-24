const LOCAL_HOSTS=new Set(["localhost","127.0.0.1","::1"]);

export function executionEndpointIssue(raw,{label="serviço",hostname=""}={}){
  const value=String(raw||"").trim().replace(/\/$/,"");
  if(!value)return "Configure o endereço HTTPS do "+label+" em Configurações → Conexão de execução.";
  let url;
  try{url=new URL(value)}catch{return "O endereço do "+label+" não é uma URL válida."}
  if(!["https:","http:"].includes(url.protocol))return "O "+label+" deve usar HTTP ou HTTPS.";
  const localPage=LOCAL_HOSTS.has(String(hostname||"").toLowerCase());
  const localTarget=LOCAL_HOSTS.has(String(url.hostname||"").toLowerCase());
  if(!localPage&&(url.protocol!=="https:"||localTarget))return "O site público exige "+label+" acessível por HTTPS; endereços locais ou HTTP não funcionam para outros usuários.";
  return "";
}

export function analysisExecutionIssue({selected=[],engines=[],individualApi="",comparatorApi="",browserSupported=()=>false,hostname=""}={}){
  const ids=Array.isArray(selected)?selected:[...selected||[]];
  if(ids.length===0)return "Selecione pelo menos um motor em Configurações.";
  if(ids.length===1){
    const id=ids[0],engine=engines.find(item=>item.id===id);
    if(engine?.browser_ready&&browserSupported(id))return "";
    return executionEndpointIssue(individualApi,{label:"backend individual de "+(engine?.name||id),hostname});
  }
  return executionEndpointIssue(comparatorApi,{label:"comparador cloud",hostname});
}
