export default async function handler(req, res) {
    // 1. Trava de segurança da Origem
    const origin = req.headers.origin || req.headers.referer || '';
    if (!origin.includes("vercel.app") && !origin.includes("localhost") && !origin.includes("miccorretores.com.br")) {
        return res.status(403).json({ error: "Acesso bloqueado. Origem não autorizada." });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const { locacao_id, mes_ref, acao } = req.body || {};
    const revisao = acao === 'preparar_revisao' || acao === 'confirmar_revisao';
    if (!revisao && !['consultar_vencida', 'conferir_previa', 'excluir'].includes(acao))
        return res.status(400).json({error:'Ação desconhecida.'});
    if (!/^[\w-]+$/.test(String(locacao_id ?? '')) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes_ref || ''))
        return res.status(400).json({error:'Locação ou competência inválida.'});
    const ASAAS_KEY = process.env.ASAAS_API_KEY;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uztsmkhlvoemjbbyebcr.supabase.co';

    try {
        const authorization = req.headers.authorization || '';
        if (!/^Bearer [^ ]+$/.test(authorization)) return res.status(401).json({error:'Entre novamente.'});
        const sessao = await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:SUPABASE_KEY,Authorization:authorization}});
        if (!sessao.ok) return res.status(401).json({error:'Sessão não confirmada.'});
        const usuario = await sessao.json();
        let claims;
        try { claims = JSON.parse(Buffer.from(authorization.split('.')[1], 'base64url').toString()); } catch {}
        if (!usuario.id || !usuario.email || claims?.sub !== usuario.id || claims?.aal !== 'aal2')
            return res.status(403).json({error:'Conclua a autenticação em duas etapas.'});
        if (revisao) return revisarFatura(req,res,usuario);
        const leitura=await fetch(SUPABASE_URL+'/rest/v1/locacoes?id=eq.'+locacao_id+'&select=user_email,status_cobranca',{
            headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY}});
        if (!leitura.ok) return res.status(502).json({error:'Não foi possível confirmar a locação.'});
        const [locacao]=await leitura.json();
        if (locacao?.user_email?.toLowerCase() !== usuario.email.toLowerCase())
            return res.status(403).json({error:'Operação restrita ao responsável pela locação.'});
        const estado=objeto(locacao.status_cobranca);
        if (estado[mes_ref+'_emissao'] || estado[mes_ref+'_revisao'] || ['transportada','recebida'].includes(estado[mes_ref]))
            return res.status(409).json({error:'Competência indisponível para esta operação.'});
        const externalReference = `${locacao_id}||${mes_ref}`;

        // ==========================================
        // ETAPA 1: EXCLUIR NO ASAAS (Se existir)
        // ==========================================
        // Busca a cobrança no Asaas pelo externalReference
        const searchRes = await fetch(`https://api.asaas.com/v3/payments?externalReference=${encodeURIComponent(externalReference)}`, {
            headers: { 'access_token': ASAAS_KEY }
        });

        if (!searchRes.ok) {
            return res.status(502).json({
                error: 'Falha ao consultar a cobrança no Asaas. O registro foi mantido no painel.'
            });
        }

        const searchData = await searchRes.json();

        if (!Array.isArray(searchData?.data) || searchData.hasMore) {
            return res.status(409).json({
                error: 'A consulta não identificou a cobrança com segurança. Confira no Asaas antes de excluir.'
            });
        }

        const faturas = searchData.data.filter(p => !p.deleted);

        if (faturas.length !== 1) {
            return res.status(409).json({
                error: faturas.length === 0
                    ? 'Nenhuma fatura ativa foi localizada no Asaas. O registro foi mantido no painel.'
                    : 'Há mais de uma fatura para este imóvel e mês. Confira no Asaas antes de excluir.'
            });
        }

        const fatura = faturas[0];

        if (!fatura.id || fatura.externalReference !== externalReference) {
            return res.status(409).json({
                error: 'A fatura encontrada não corresponde à referência esperada. Confira no Asaas.'
            });
        }

        if (!['PENDING', 'OVERDUE'].includes(fatura.status)) {
            return res.status(409).json({
                error: `Exclusão bloqueada. Situação da fatura no Asaas: ${fatura.status}.`
            });
        }

        if (acao !== 'excluir') {
            const hoje = new Intl.DateTimeFormat('sv-SE', {
                timeZone: 'America/Sao_Paulo',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).format(new Date());

            const vencimento = fatura.dueDate;

            if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento) || hoje <= vencimento) {
                return res.status(409).json({
                    error: 'A fatura ainda não venceu ou está sem vencimento válido no Asaas.'
                });
            }

            const valorFatura = fatura.value;
            const tarifaCentavos = 299;

            if (typeof valorFatura !== 'number' || !Number.isFinite(valorFatura)) {
                return res.status(409).json({
                    error: 'O Asaas não informou um valor válido para esta fatura.'
                });
            }

            const totalCentavos = Math.round(valorFatura * 100);
            const saldoCentavos = totalCentavos - tarifaCentavos;

            if (!Number.isSafeInteger(saldoCentavos) || saldoCentavos <= 0) {
                return res.status(409).json({
                    error: 'O valor da fatura não permite separar a tarifa bancária de R$ 2,99.'
                });
            }

                        const previa = {
                faturaId: fatura.id,
                vencimento,
                totalCentavos,
                tarifaCentavos,
                saldoCentavos
            };

            const mesVencimento = vencimento.slice(0, 7);

            if (hoje.slice(0, 7) !== mesVencimento) {
                return res.status(200).json({
                    ...previa,
                    etapa: 'virada_do_mes'
                });
            }

            const multaCentavos = Math.round(saldoCentavos * 10 / 100);
            const jurosCentavos = Math.round(saldoCentavos / 100);
            const saldoAtualizadoCentavos =
                saldoCentavos + multaCentavos + jurosCentavos;

            const [ano, mes] = mesVencimento.split('-').map(Number);
            const novoVencimento = new Date(Date.UTC(ano, mes, 0))
                .toISOString()
                .slice(0, 10);

            const novoTotalCentavos = saldoAtualizadoCentavos + tarifaCentavos;

            const valoresParaConfirmar = {
                faturaId: fatura.id,
                vencimentoOriginal: vencimento,
                totalOriginalCentavos: totalCentavos,
                novoVencimento,
                novoTotalCentavos
            };

            if (acao === 'conferir_previa') {
                const exibido = req.body.valoresParaConfirmar;

                const mesmaPrevia = exibido != null &&
                    Object.entries(valoresParaConfirmar).every(
                        ([campo, valorAtual]) => exibido[campo] === valorAtual
                    );

                if (!mesmaPrevia) {
                    return res.status(409).json({
                        error: 'A fatura ou os valores mudaram. Abra uma nova prévia.'
                    });
                }
            }

            return res.status(200).json({
                ...previa,
                etapa: 'primeiro_atraso',
                multaCentavos,
                jurosCentavos,
                saldoAtualizadoCentavos,
                novoTotalCentavos,
                novoVencimento,
                valoresParaConfirmar,
                previaConferida: acao === 'conferir_previa'
            });
        }

        const exclusao = await fetch(`https://api.asaas.com/v3/payments/${encodeURIComponent(fatura.id)}`, {
            method: 'DELETE',
            headers: { 'access_token': ASAAS_KEY }
        });

        if (!exclusao.ok) {
            return res.status(502).json({
                error: 'O Asaas não confirmou a exclusão. O registro foi mantido no painel.'
            });
        }

        // ==========================================
        // ETAPA 2: LIMPAR TABELA DE DISPAROS DE E-MAIL
        // ==========================================
        // Isso impede que o cron-emails.js tente mandar e-mail de algo deletado
        await fetch(`${SUPABASE_URL}/rest/v1/disparos_email?locacao_id=eq.${locacao_id}&mes_ref=eq.${mes_ref}`, {
            method: 'DELETE',
            headers: { 
                'apikey': SUPABASE_KEY, 
                'Authorization': `Bearer ${SUPABASE_KEY}` 
            }
        });

        // ==========================================
        // ETAPA 3: LIMPAR O STATUS NA TABELA LOCACOES
        // ==========================================
        // Puxar o status atual da locação
        const resGetLoc = await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${locacao_id}`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        const dataLoc = await resGetLoc.json();

        if (dataLoc && dataLoc.length > 0) {
            let statusCobranca = {};
            try { 
                statusCobranca = JSON.parse(dataLoc[0].status_cobranca || '{}'); 
            } catch(e) {}

            // Remove o status e a URL do mês específico do JSON de controle
            delete statusCobranca[mes_ref];
            delete statusCobranca[`${mes_ref}_url`];

            // Atualiza o banco salvando o JSON sem esse mês
            await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${locacao_id}`, {
                method: 'PATCH',
                headers: { 
                    'Content-Type': 'application/json', 
                    'apikey': SUPABASE_KEY, 
                    'Authorization': `Bearer ${SUPABASE_KEY}` 
                },
                body: JSON.stringify({ status_cobranca: JSON.stringify(statusCobranca) })
            });
        }

        return res.status(200).json({ success: true, message: 'Cobrança excluída com sucesso do Asaas e do sistema M&IC.' });

    } catch (error) {
        console.error("Erro ao excluir cobrança:", error);
        return res.status(500).json({ error: error.message });
    }
}

const brl = n => (n / 100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
function exigir(ok, mensagem, status = 409) {
    if (!ok) throw Object.assign(new Error(mensagem), {status});
}
function objeto(valor) {
    const dados = JSON.parse(valor ?? '{}');
    exigir(dados && typeof dados === 'object' && !Array.isArray(dados),'Histórico inválido.');
    return dados;
}
function centavos(valor) {
    if (valor == null || valor === '') return 0;
    const n = typeof valor === 'number' ? valor : Number(String(valor).replace(/\./g,'').replace(',','.'));
    exigir(Number.isFinite(n),'Valor mensal inválido.');
    return Math.round(n*100);
}
async function chamar(url, options) {
    const r = await fetch(url,options);
    exigir(r.ok,'O serviço não confirmou a operação (HTTP '+r.status+').',502);
    const texto = await r.text();
    return texto ? JSON.parse(texto) : null;
}
function calcular(p, mes, hoje, lanc) {
    const vencimento=p.dueDate;
    exigir(/^\d{4}-\d{2}-\d{2}$/.test(vencimento) && hoje>vencimento,'A fatura precisa estar vencida.');
    exigir(vencimento.slice(0,7)===mes,'Vencimento e competência divergentes. Confira a fatura.');
    const totalCentavos=centavos(p.value), saldoCentavos=totalCentavos-299;
    exigir(Number.isSafeInteger(saldoCentavos) && saldoCentavos>0,'Saldo da fatura inválido.');
    const recebido=lanc.transporte_recebido?.totalCentavos ?? 0;
    exigir(Number.isSafeInteger(recebido) && recebido>=0 && recebido<=saldoCentavos,'Saldo transportado divergente.');
    const jaAtualizada=lanc.reemissao?.id===p.id;
    const base=jaAtualizada ? 0 : saldoCentavos-recebido;
    const multaCentavos=Math.round(base/10), jurosCentavos=Math.round(base/100);
    const saldoAtualizadoCentavos=saldoCentavos+multaCentavos+jurosCentavos;
    const [ano,m]=mes.split('-').map(Number);
    const novoVencimento=new Date(Date.UTC(ano,m,0)).toISOString().slice(0,10);
    const destino=new Date(Date.UTC(ano,m,1)).toISOString().slice(0,7);
    const transportar=hoje>novoVencimento;
    const jurosTransporteCentavos=transportar ? Math.round(saldoAtualizadoCentavos/100) : 0;
    const transporteCentavos=saldoAtualizadoCentavos+jurosTransporteCentavos;
    const etapa=transportar?'virada_do_mes':'primeiro_atraso';
    const novoTotalCentavos=saldoAtualizadoCentavos+299;
    const descricao=transportar ? [
        'Valor devido mês anterior = '+brl(saldoAtualizadoCentavos),
        'Juros sobre saldo devedor 1% = '+brl(jurosTransporteCentavos),
        'Valor total = '+brl(transporteCentavos)
    ].join('\n') : [
        'Saldo sem tarifa = '+brl(saldoCentavos),'Multa de 10% = '+brl(multaCentavos),
        'Juros de 1% = '+brl(jurosCentavos),'Tarifa bancária = '+brl(299),
        'Valor total = '+brl(novoTotalCentavos)
    ].join('\n');
    const valoresParaConfirmar={faturaId:p.id,vencimentoOriginal:vencimento,totalOriginalCentavos:totalCentavos,
        novoVencimento,novoTotalCentavos,etapa,destino,transporteCentavos};
    return {faturaId:p.id,vencimento,totalCentavos,tarifaCentavos:299,saldoCentavos,etapa,multaCentavos,
        jurosCentavos,saldoAtualizadoCentavos,novoTotalCentavos,novoVencimento,destino,jurosTransporteCentavos,
        transporteCentavos,descricao,valoresParaConfirmar};
}
async function revisarFatura(req,res,user) {
    let travado=false;
    try {
        exigir(req.method==='POST','Método não permitido.',405);
        const host=new URL(req.headers.origin || req.headers.referer || 'https://invalid.invalid').hostname;
        exigir(host==='localhost'||host==='miccorretores.com.br'||host.endsWith('.miccorretores.com.br')||host.endsWith('.vercel.app'),'Origem não autorizada.',403);
        const {locacao_id:id,mes_ref:mes,acao,valoresParaConfirmar}=req.body || {};
        exigir(/^[\w-]+$/.test(String(id??'')) && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes),'Ação, locação ou competência inválida.',400);
        const db=process.env.SUPABASE_URL || 'https://uztsmkhlvoemjbbyebcr.supabase.co';
        const key=process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
        const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'};
        const api=(process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3').replace(/\/$/,'')+'/payments';
        const ah={access_token:process.env.ASAAS_API_KEY,'Content-Type':'application/json'};
        const ref=id+'||'+mes;
        const tabela=db+'/rest/v1/locacoes';
        const [row]=await chamar(tabela+'?id=eq.'+id+'&select=email_inquilino,inquilino,user_email,status_cobranca,lancamentos_mensais,aluguel_base,taxa_adm_fixa,regra_condominio,regra_seguro',{headers});
        exigir(row,'Locação não encontrada.');
        exigir(user.email.toLowerCase()===row.user_email?.toLowerCase(),'Operação restrita ao responsável pelo cadastro.',403);
        const st=objeto(row.status_cobranca), meses=objeto(row.lancamentos_mensais);
        const registro=meses[mes] || {};
        const recibo = req.body.reciboBase64;
        const operacao=mes+'_revisao';
        exigir(!st[operacao],'Já existe uma operação registrada. Confira o Asaas e o painel antes de prosseguir.');
        exigir(!['recebida','transportada'].includes(st[mes]),'Competência recebida ou transportada.');
        const busca=await chamar(api+'?externalReference='+encodeURIComponent(ref),{headers:ah});
        exigir(Array.isArray(busca?.data) && !busca.hasMore,'Consulta de faturas incompleta.');
        const ativas=busca.data.filter(p=>!p.deleted && p.status!=='REFUNDED');
        exigir(ativas.length===1,'É necessário identificar exatamente uma fatura ativa.');
        const p=ativas[0];
        function validar(f){
            exigir(f?.id===p.id && f.id && !f.deleted && f.externalReference===ref && ['PENDING','OVERDUE'].includes(f.status),'Fatura ausente, paga ou alterada.');
            exigir(!st[mes+'_fatura_id'] || st[mes+'_fatura_id']===f.id,'O ID ativo no painel diverge do Asaas.');
        }
        validar(p);
        let previa;
        if(acao!=='excluir'){
            const hoje=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
            previa=calcular(p,mes,hoje,registro);
            if(acao==='preparar_revisao') return res.status(200).json(previa);
            exigir(Object.entries(previa.valoresParaConfirmar).every(([k,v])=>valoresParaConfirmar?.[k]===v),'A prévia mudou. Consulte novamente.');
            if(acao==='conferir_previa') return res.status(200).json({...previa,previaConferida:true});
        }
        const transportar=previa?.etapa==='virada_do_mes';
        let destino;
        if(transportar){
            destino=meses[previa.destino] ||= {};
            exigir(!st[previa.destino] && !st[previa.destino+'_url'] && !destino.transporte_recebido,'A competência seguinte já tem cobrança ou transporte.');
            const futuras=await chamar(api+'?externalReference='+encodeURIComponent(id+'||'+previa.destino),{headers:ah});
            exigir(Array.isArray(futuras?.data) && !futuras.hasMore && futuras.data.every(f=>f.deleted || f.status==='REFUNDED'),'Já existe cobrança no Asaas para a competência seguinte.');
            centavos(destino.outras_taxas);
        }
        if (!transportar) {
            exigir(row.email_inquilino && row.inquilino,'Confira o nome e o e-mail do inquilino antes de substituir.');
            exigir(typeof recibo==='string' && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(recibo) && recibo.length<=4000000,
                'A confirmação precisa incluir a imagem da prévia atualizada.');
        }
        let esperado=row.status_cobranca;
        async function salvar(campos){
            const eq=v=>v==null?'is.null':'eq.'+v;
            const q=new URLSearchParams({id:'eq.'+id,status_cobranca:eq(esperado),lancamentos_mensais:eq(row.lancamentos_mensais),select:'id'});
            const linhas=await chamar(tabela+'?'+q,{method:'PATCH',headers,body:JSON.stringify(campos)});
            exigir(linhas?.length===1,'O registro mudou. Recarregue o painel.');
            esperado=campos.status_cobranca;
        }
        st[operacao]={acao,origem:p.id,previa,inicio:new Date().toISOString()};
        await salvar({status_cobranca:JSON.stringify(st)});
        travado=true;
        const atual=await chamar(api+'/'+encodeURIComponent(p.id),{headers:ah});
        validar(atual);
        exigir(atual.value===p.value && atual.dueDate===p.dueDate,'O valor ou vencimento mudou.');
        const cancelada=await chamar(api+'/'+encodeURIComponent(p.id),{method:'DELETE',headers:ah});
        exigir(cancelada?.deleted===true && cancelada.id===p.id,'Cancelamento não confirmado.');
        await chamar(db+'/rest/v1/disparos_email?locacao_id=eq.'+id+'&mes_ref=eq.'+mes,{method:'DELETE',headers:{...headers,Prefer:'return=minimal'}});
        delete st[mes+'_url']; delete st[mes+'_fatura_id'];
        if(acao==='excluir'){
            delete st[mes];
            if(registro.reemissao?.id===p.id) delete registro.reemissao;
        } else if(transportar){
            destino.outras_taxas=((centavos(destino.outras_taxas)+previa.transporteCentavos)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
            destino.desc_outras=[destino.desc_outras,previa.descricao].filter(Boolean).join('\n');
            destino.transporte_recebido={origem:mes,faturaId:p.id,totalCentavos:previa.transporteCentavos,
                previa,composicaoOrigem:registro,aluguelBase:row.aluguel_base,taxaAdm:row.taxa_adm_fixa,
                regraCondominio:row.regra_condominio,regraSeguro:row.regra_seguro};
            st[mes]='transportada';
        } else {
            const nova=await chamar(api,{method:'POST',headers:ah,body:JSON.stringify({customer:p.customer,billingType:'PIX',
                value:previa.novoTotalCentavos/100,dueDate:previa.novoVencimento,description:previa.descricao,externalReference:ref})});
            exigir(nova?.id && nova.invoiceUrl,'Emissão não confirmada.');
            // Guardar o novo ID antes de agendar: uma falha não autoriza nova emissão.
            st[operacao].substituta = {id:nova.id,url:nova.invoiceUrl};
            await salvar({status_cobranca:JSON.stringify(st)});
            await chamar(db+'/rest/v1/disparos_email',{method:'POST',headers:{...headers,Prefer:'return=minimal'},
                body:JSON.stringify({locacao_id:id,mes_ref:mes,email_inquilino:row.email_inquilino,
                    nome_inquilino:row.inquilino,valor_total:previa.novoTotalCentavos/100,
                    link_asaas:nova.invoiceUrl,data_vencimento:previa.novoVencimento,recibo_base64:recibo,
                    status_disparo_1:false,status_disparo_2:false,status_disparo_3:false})});
            st[mes]='aguardando_asaas'; st[mes+'_url']=nova.invoiceUrl; st[mes+'_fatura_id']=nova.id;
            meses[mes]={...registro,vencimento_custom:previa.novoVencimento,reemissao:{id:nova.id,origem:p.id,previa}};
        }
        delete st[operacao];
        await salvar({status_cobranca:JSON.stringify(st),lancamentos_mensais:JSON.stringify(meses)});
        return res.status(200).json({success:true,etapa:previa?.etapa || 'excluida',urlFatura:st[mes+'_url'],destino:transportar?previa.destino:undefined});
    } catch(e){
        return res.status(e.status || 502).json({error:travado?'Operação interrompida. Confira a fatura no Asaas e o registro de revisão antes de repetir. '+e.message:e.message});
    }
}
