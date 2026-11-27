export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'Método não permitido.'});
  const base = 'https://uztsmkhlvoemjbbyebcr.supabase.co';
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  const authorization = req.headers.authorization || '';
  if (!/^Bearer [^ ]+$/.test(authorization)) return res.status(401).json({error:'Entre no aplicativo antes de executar.'});
  if (!key) return res.status(503).json({error:'Servidor sem SUPABASE_SERVICE_KEY ou SUPABASE_KEY.'});
  const get = (url, headers) => fetch(url, {method:'GET',headers,signal:AbortSignal.timeout(10000)});
  try {
    const auth = await get(base+'/auth/v1/user',{apikey:key,Authorization:authorization});
    if (!auth.ok) return res.status(401).json({error:'Sessão inválida ou expirada. Entre novamente no aplicativo.'});
    const user = await auth.json();
    let claims;
    try { claims=JSON.parse(Buffer.from(authorization.slice(7).split('.')[1],'base64url').toString()); } catch {}
    if (!user.id || !user.email || claims?.sub !== user.id || claims?.aal !== 'aal2')
      return res.status(403).json({error:'Conclua a autenticação em duas etapas.'});
    const headers={apikey:key,Authorization:'Bearer '+key};
    const q=new URLSearchParams({select:'id',user_email:'eq.'+user.email,limit:'1'});
    const own=await get(base+'/rest/v1/locacoes?'+q,headers);
    if (!own.ok) return res.status(502).json({etapa:'validar_acesso_locacoes',http_supabase:own.status,error:'Falha ao validar acesso às locações.'});
    const rows=await own.json();
    if (!Array.isArray(rows) || !rows.length) return res.status(403).json({error:'Diagnóstico restrito a responsável por locação cadastrada.'});
    // GET com limite zero: valida tabela e colunas sem retornar dados de clientes.
    const campos='id,locacao_id,mes_ref,email_inquilino,nome_inquilino,valor_total,link_asaas,data_vencimento,recibo_base64,status_disparo_1,status_disparo_2,status_disparo_3';
    const r=await get(base+'/rest/v1/disparos_email?'+new URLSearchParams({select:campos,limit:'0'}),headers);
    const raw=await r.text();let body;try{body=JSON.parse(raw)}catch{}
    const result={modo:'SOMENTE_LEITURA',projeto:'uztsmkhlvoemjbbyebcr',tabela:'public.disparos_email',http_supabase:r.status,configuracao_usada:process.env.SUPABASE_SERVICE_KEY?'SUPABASE_SERVICE_KEY':'SUPABASE_KEY',resend_configurado:!!process.env.RESEND_API_KEY,cron_secret_configurado:!!process.env.CRON_SECRET,banco_alterado:false,email_enviado:false,cobranca_criada:false};
    if(r.ok) result.resultado='Tabela e colunas acessíveis para leitura. Este teste não valida permissão de INSERT nem entrega de e-mail.';
    else {
      result.erro_supabase={};
      for(const campo of ['code','message','details','hint']) {
        if(typeof body?.[campo]==='string') result.erro_supabase[campo]=body[campo].split(key).join('[OCULTO]').split(authorization.slice(7)).join('[OCULTO]').slice(0,2000);
      }
      if(!Object.keys(result.erro_supabase).length) result.erro_supabase.message='Resposta sem JSON de erro. Consulte o status HTTP acima.';
    }
    return res.status(200).json(result);
  } catch {
    return res.status(502).json({error:'Consulta interrompida por falha de conexão ou resposta inválida. Nenhuma operação de escrita foi realizada.'});
  }
}
