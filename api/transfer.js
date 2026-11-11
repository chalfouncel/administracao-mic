export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Método não permitido" });

    const { idReg, mesRef } = req.body;
    const SUPABASE_URL = 'https://uztsmkhlvoemjbbyebcr.supabase.co';
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    const ASAAS_KEY = process.env.ASAAS_API_KEY;

    if (!SUPABASE_KEY) {
        return res.status(500).json({ error: "Chave SUPABASE_SERVICE_KEY não encontrada nas variáveis de ambiente da Vercel." });
    }
    if (!ASAAS_KEY) {
        return res.status(500).json({ error: "ASAAS_API_KEY não configurada na Vercel." });
    }

    try {
        const resGet = await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${idReg}`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        
        if (!resGet.ok) throw new Error(`Falha ao consultar banco: ${resGet.statusText}`);
        
        const dataGet = await resGet.json();
        if (!dataGet || dataGet.length === 0) return res.status(400).json({ error: 'Contrato não encontrado' });
        const c = dataGet[0];

        function pM(str) {
            if (!str || String(str).toLowerCase() === 'não' || String(str).toLowerCase() === 'nao') return 0;
            if (typeof str === 'number') return str;
            return parseFloat(String(str).replace(/[^\d,-]/g, '').replace(',', '.')) || 0;
        }
        
        let lanc = {}; 
        try { lanc = JSON.parse(c.lancamentos_mensais || '{}'); } catch(e){}
        let lMes = lanc[mesRef] || {};
        
        let vAlugPropStr = lMes.aluguel_prop !== undefined ? lMes.aluguel_prop : "Não"; 
        let isPropActive = vAlugPropStr !== '' && String(vAlugPropStr).toLowerCase() !== 'não' && String(vAlugPropStr).toLowerCase() !== 'nao';
        
        let mesInicioContrato = c.data_inicio ? c.data_inicio.slice(0, 7) : '';
        let isMesDeEntrada = (mesInicioContrato && mesRef <= mesInicioContrato);

        let vAlugProp = pM(vAlugPropStr);
        let vCondProp = pM(lMes.cond_prop);
        let vAlugMes = lMes.aluguel_mes !== undefined 
            ? pM(lMes.aluguel_mes) 
            : ((isMesDeEntrada || isPropActive) ? 0 : pM(c.aluguel_base));
        let vCondMes = lMes.cond_mes !== undefined ? pM(lMes.cond_mes) : 0;
        let vIptu = pM(lMes.iptu);
        let vBombeiro = pM(lMes.bombeiro);
        let vSeguro = pM(lMes.seguro);
        let vOutras = pM(lMes.outras_taxas);
        let vDesconto = pM(lMes.desconto);
        let vTaxaAdm = pM(c.taxa_adm_fixa);
        
        let repassaCond = c.regra_condominio !== 'N'; 
        let repassaSeguro = c.regra_seguro !== 'N';

        let valCondominioPix = repassaCond ? 0 : (vCondProp + vCondMes);
        let valSeguroMIC = repassaSeguro ? 0 : vSeguro;
        
        let totalReceitas = Math.round((vAlugProp + vAlugMes + vCondProp + vCondMes + vIptu + vBombeiro + vSeguro + vOutras - vDesconto) * 100) / 100;
        
        let valProprietario = Math.round((totalReceitas - vTaxaAdm - valCondominioPix - valSeguroMIC) * 100) / 100;
        let valMIC = Math.round((vTaxaAdm + valSeguroMIC) * 100) / 100;

        const revisado = Boolean(lMes.transporte_recebido || lMes.reemissao);
        if (revisado) {
            const cent = valor => Math.round(pM(valor) * 100);
            const soma = partes => partes.reduce((a,b) => a+b, 0);

            // Distribui o total já cobrado. Maiores restos recebem os centavos indivisíveis.
            function acrescer(partes, adicional) {
                const base = soma(partes);
                if (!Number.isSafeInteger(adicional) || adicional < 0 ||
                    partes.some(v => !Number.isSafeInteger(v) || v < 0) || (!base && adicional)) {
                    throw new Error('Composição inválida para rateio.');
                }
                if (!adicional) return partes.slice();
                const produtos = partes.map(v => BigInt(v) * BigInt(adicional));
                const quotas = produtos.map(v => Number(v / BigInt(base)));
                const ordem = produtos.map((v,i) => ({i, resto:v % BigInt(base)}))
                    .sort((a,b) => a.resto === b.resto ? a.i-b.i : a.resto>b.resto ? -1:1);
                const restantes = adicional - soma(quotas);
                for (let i=0; i<restantes; i++) quotas[ordem[i].i]++;
                return partes.map((v,i) => v + quotas[i]);
            }

            function distribuir(registro, regras, principal, previa) {
                const anterior = registro.transporte_recebido;
                const herdado = anterior?.totalCentavos || 0;
                const mic = cent(regras.taxaAdm) + (regras.regraSeguro === 'N' ? cent(registro.seguro) : 0);
                const cond = regras.regraCondominio === 'N' ? cent(registro.cond_prop)+cent(registro.cond_mes) : 0;
                const novas = [principal-herdado-mic-cond, mic, cond];
                if (novas.some(v=>!Number.isSafeInteger(v)||v<0)) throw new Error('Confira a composição do principal.');
                const multa = previa?.multaCentavos || 0;
                const juros = previa?.jurosCentavos || 0;
                const comMulta = acrescer(novas,multa);
                const comJuros = acrescer(novas,juros);
                const partes = novas.map((v,i)=>comMulta[i]+comJuros[i]-v);
                if (anterior) {
                    const origem = anterior.composicaoOrigem;
                    const primeira = origem.reemissao?.previa || anterior.previa;
                    const originais = distribuir(origem,anterior,primeira.saldoCentavos,primeira);
                    const corrigidas = acrescer(originais,anterior.previa.jurosTransporteCentavos);
                    if (soma(corrigidas)!==herdado) throw new Error('Saldo anterior divergente.');
                    corrigidas.forEach((v,i)=>partes[i]+=v);
                }
                return partes;
            }

            const partes = distribuir(lMes, {taxaAdm:c.taxa_adm_fixa,regraSeguro:c.regra_seguro,
                regraCondominio:c.regra_condominio}, Math.round(totalReceitas*100),lMes.reemissao?.previa);
            [valProprietario,valMIC,valCondominioPix] = partes.map(v=>v/100);
            if ((valProprietario>0 && !c.pix_proprietario) || (valCondominioPix>0 && !c.pix_condominio))
                throw new Error('Confira os dados de pagamento dos recebedores antes do repasse.');
        }
        // TRAVA DE SEGURANÇA BANCÁRIA: Verifica a fatura paga no Asaas antes de transferir
        const extRef = `${idReg}||${mesRef}`;
        const paySearchRes = await fetch(`https://api.asaas.com/v3/payments?externalReference=${encodeURIComponent(extRef)}`, {
            headers: { 'access_token': ASAAS_KEY }
        });
        const paySearchData = await paySearchRes.json();
        const faturasPagas = (paySearchData.data || []).filter(p => p.status === 'RECEIVED' || p.status === 'CONFIRMED');

        if (revisado) {
            const status = JSON.parse(c.status_cobranca || '{}');
            const paga = faturasPagas[0];
            if (!paySearchRes.ok || paySearchData.hasMore || faturasPagas.length!==1 || paga.deleted ||
                status[mesRef]!=='recebida' || status[mesRef+'_fatura_id']!==paga.id ||
                Math.round(paga.value*100)-299 !== Math.round((valProprietario+valMIC+valCondominioPix)*100)) {
                return res.status(409).json({error:'Fatura recebida ou composição do rateio divergente. Confira antes de transferir.'});
            }
        }

        const cobrancas = JSON.parse(c.status_cobranca || '{}');
        if (!paySearchRes.ok || paySearchData.hasMore || faturasPagas.length !== 1 ||
            faturasPagas[0].deleted || faturasPagas[0].externalReference !== extRef ||
            cobrancas[mesRef] !== 'recebida' || cobrancas[mesRef+'_revisao'] ||
            (cobrancas[mesRef+'_fatura_id'] && cobrancas[mesRef+'_fatura_id'] !== faturasPagas[0].id)) {
            return res.status(409).json({error:'Pagamento não confirmado para esta competência.'});
        }
        if (faturasPagas.length > 0) {
            const valorPagoLiquidoCob = Math.round((faturasPagas[0].value - 2.99) * 100) / 100;
            const somaSaidas = Math.round((valProprietario + valMIC + valCondominioPix) * 100) / 100;

            if (Math.abs(somaSaidas - valorPagoLiquidoCob) > 0.05) {
                const msgDiv = `BLOQUEIO DE SEGURANÇA: Soma dos repasses (R$ ${somaSaidas.toFixed(2)}) diverge do valor pago pelo inquilino sem tarifa (R$ ${valorPagoLiquidoCob.toFixed(2)}). Verifique a aba Taxas Condominiais.`;
                return res.status(409).json({error:msgDiv});
            }
        }

        async function executeTransfer(value, rawKey, titular, desc) {
            if (!rawKey || value <= 0) throw Error('Destino ou valor inválido.');

            const cleanKey = String(rawKey).trim();
            let payloadTransf = {};

            if (cleanKey.startsWith('TED|')) {
                const parts = cleanKey.split('|');
                const [, banco, agencia, conta, tipoConta, cpf] = parts;
                payloadTransf = {
                    value: parseFloat(value.toFixed(2)),
                    bankAccount: {
                        bank: { code: (banco || '').trim() },
                        accountName: titular || 'Titular Indefinido',
                        ownerName: titular || 'Titular Indefinido',
                        cpfCnpj: (cpf || '').replace(/\D/g, ''),
                        agency: (agencia || '').replace(/\D/g, ''),
                        account: (conta || '').split('-')[0].replace(/\D/g, ''),
                        accountDigit: (conta || '').includes('-') ? conta.split('-')[1].replace(/\D/g, '') : '',
                        bankAccountType: tipoConta || 'CONTA_CORRENTE'
                    },
                    description: desc
                };
            } else {
                let keyType = 'EVP';
                let finalKey = cleanKey;

                const isCpf = (cpf) => {
                    cpf = cpf.replace(/\D/g, '');
                    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
                    let sum = 0, rest;
                    for (let i = 1; i <= 9; i++) sum = sum + parseInt(cpf.substring(i-1, i)) * (11 - i);
                    rest = (sum * 10) % 11;
                    if ((rest === 10) || (rest === 11)) rest = 0;
                    if (rest !== parseInt(cpf.substring(9, 10))) return false;
                    sum = 0;
                    for (let i = 1; i <= 10; i++) sum = sum + parseInt(cpf.substring(i-1, i)) * (12 - i);
                    rest = (sum * 10) % 11;
                    if ((rest === 10) || (rest === 11)) rest = 0;
                    return rest === parseInt(cpf.substring(10, 11));
                };

                if (cleanKey.includes('@')) {
                    keyType = 'EMAIL';
                } else if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanKey)) {
                    keyType = 'EVP';
                } else {
                    let digits = cleanKey.replace(/\D/g, '');
                    if (digits.length === 14) {
                        keyType = 'CNPJ';
                        finalKey = digits;
                    } else if (digits.length === 11) {
                        if (isCpf(digits)) {
                            keyType = 'CPF';
                            finalKey = digits;
                        } else {
                            keyType = 'PHONE';
                            finalKey = digits.startsWith('55') ? '+' + digits : '+55' + digits;
                        }
                    } else if (digits.length >= 10 && digits.length <= 13) {
                        keyType = 'PHONE';
                        finalKey = digits.startsWith('55') ? '+' + digits : '+55' + digits;
                    }
                }

                payloadTransf = {
                    value: parseFloat(value.toFixed(2)),
                    operationType: "PIX",
                    pixAddressKey: finalKey,
                    pixAddressKeyType: keyType,
                    description: desc
                };
            }

            const transferRes = await fetch('https://api.asaas.com/v3/transfers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'access_token': ASAAS_KEY },
                body: JSON.stringify(payloadTransf)
            });
            
            const transferData = await transferRes.json();
            
            if (!transferRes.ok || transferData.errors) {
                const erroMsg = transferData.errors?.[0]?.description || transferData.message || JSON.stringify(transferData);
                // Rejeição de autenticação não criou uma ordem. Outros erros sem ID
                // (inclusive suspeita de duplicidade) precisam de conciliação.
                return { success:false, recusada:transferRes.status===401 && !transferData.id, error:erroMsg };
            }
            if (!transferData.id) return { success: false, error: "Falha desconhecida no banco Asaas." };
            return { success: true, id: transferData.id, status:transferData.status };
        }

        const statusRepasse = JSON.parse(c.status_repasse ?? '{}');
        if (!statusRepasse || typeof statusRepasse !== 'object' || Array.isArray(statusRepasse)) throw Error('Histórico inválido.');
        if (statusRepasse[mesRef] === 'recebida') return res.status(200).json({success:true,statusRepasse});
        let esperado = c.status_repasse;
        async function gravar() {
            const filtro = v => v == null ? 'is.null' : 'eq.'+v;
            const q = new URLSearchParams({id:'eq.'+idReg,status_repasse:filtro(esperado),status_cobranca:filtro(c.status_cobranca),lancamentos_mensais:filtro(c.lancamentos_mensais),select:'id'});
            const valor = JSON.stringify(statusRepasse);
            const r = await fetch(SUPABASE_URL+'/rest/v1/locacoes?'+q,{method:'PATCH',
                headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},
                body:JSON.stringify({status_repasse:valor})});
            if (!r.ok || (await r.json()).length !== 1) throw Error('Estado não confirmado. Recarregue e confira o repasse.');
            esperado = valor;
        }
        const propJaPago = statusRepasse[mesRef+'_prop']==='pago' || valProprietario<=0;
        const micJaPago = statusRepasse[mesRef+'_mic']==='pago' || valMIC<=0;
        const condJaPago = statusRepasse[mesRef+'_cond']==='pago' || valCondominioPix<=0;
        let totalPendenteTransferir = 0;
        if (!propJaPago && statusRepasse[mesRef+'_prop']!=='enviado') totalPendenteTransferir += valProprietario;
        if (!micJaPago && statusRepasse[mesRef+'_mic']!=='enviado') totalPendenteTransferir += valMIC;
        if (!condJaPago && statusRepasse[mesRef+'_cond']!=='enviado') totalPendenteTransferir += valCondominioPix;
        totalPendenteTransferir = Math.round(totalPendenteTransferir * 100) / 100;

        // TRAVA DE SALDO DISPONÍVEL NO ASAAS: Só inicia se houver saldo para cobrir TODAS as transferências pendentes deste imóvel
        if (totalPendenteTransferir > 0) {
            const balRes = await fetch('https://api.asaas.com/v3/finance/balance', {
                headers: { 'access_token': ASAAS_KEY }
            });
            if (balRes.ok) {
                const balData = await balRes.json();
                const saldoConta = typeof balData.balance === 'number' ? balData.balance : 0;
                if (saldoConta < totalPendenteTransferir) {
                    const msgSaldo = `BLOQUEIO PREVENTIVO: Saldo disponível no Asaas (R$ ${saldoConta.toFixed(2)}) insuficiente para cobrir o repasse total pendente deste imóvel (R$ ${totalPendenteTransferir.toFixed(2)}). Nenhuma transferência foi feita.`;
                    return res.status(409).json({error:msgSaldo});
                }
            }
        }

        const destinos = [
            ['prop',valProprietario,c.pix_proprietario,c.titular_pix || c.proprietario,'Repasse M&IC '+mesRef+' - '+c.inquilino],
            ['mic',valMIC,'chalfouncorretor@gmail.com','M&IC Corretores','Taxa Adm + Seguro '+mesRef+' - '+c.inquilino],
            ['cond',valCondominioPix,c.pix_condominio,'Condomínio','Condomínio M&IC '+mesRef+' - '+c.id]
        ];
        for (const [tipo,valor,chave] of destinos) {
            const estado=statusRepasse[mesRef+'_'+tipo];
            if (estado==='conferir') return res.status(409).json({error:'Confira o PIX de '+tipo+' no Asaas antes de liberar outra tentativa.',statusRepasse});
            if (!Number.isFinite(valor) || valor<0 || (valor>0 && !chave && estado!=='pago')) throw Error('Confira valor e destino do repasse.');
        }
        for (const [tipo,valor,chave,titular,descricao] of destinos) {
            const campo=mesRef+'_'+tipo;
            if (valor===0 || statusRepasse[campo]==='pago') continue;
            if (statusRepasse[campo]==='enviado') {
                const idAnterior=statusRepasse[campo+'_asaas_id'];
                if (!idAnterior) throw Error('Transferência sem ID. Confira no Asaas.');
                const consulta=await fetch('https://api.asaas.com/v3/transfers/'+encodeURIComponent(idAnterior),
                    {headers:{access_token:ASAAS_KEY}});
                if (!consulta.ok) throw Error('Falha ao consultar transferência anterior. Nenhum reenvio autorizado.');
                const anterior=await consulta.json();
                if (anterior.id!==idAnterior || Math.round(anterior.value*100)!==Math.round(valor*100))
                    throw Error('A transferência consultada diverge do registro. Confira no Asaas.');
                if (anterior.status==='DONE') {
                    statusRepasse[campo]='pago';
                    await gravar();
                    continue;
                }
                if (anterior.status==='FAILED') {
                    statusRepasse[campo]='pendente';
                    await gravar();
                    return res.status(409).json({error:'Asaas confirmou falha. Após corrigir a causa, tente novamente.',statusRepasse});
                }
                return res.status(409).json({error:'Transferência já enviada. Aguarde a conclusão e consulte novamente.',statusRepasse});
            }
            statusRepasse[campo]='conferir';
            await gravar();
            const envio=await executeTransfer(valor,chave,titular,descricao);
            if (!envio.success) {
                if (envio.recusada) statusRepasse[campo]='pendente';
                statusRepasse[mesRef+'_erro']=envio.error;
                await gravar();
                return res.status(409).json({error:envio.error,statusRepasse});
            }
            statusRepasse[campo]=envio.status==='DONE'?'pago':'enviado';
            statusRepasse[campo+'_asaas_id']=envio.id;
            await gravar();
            if (statusRepasse[campo]==='enviado') return res.status(409).json({error:'Ordem recebida pelo Asaas. Consulte novamente para verificar o resultado.',statusRepasse});
        }
        statusRepasse[mesRef]='recebida';
        delete statusRepasse[mesRef+'_erro'];
        await gravar();
        return res.status(200).json({ success: true, statusRepasse });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
