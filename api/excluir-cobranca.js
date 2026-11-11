export default async function handler(req, res) {
    // 1. Trava de segurança da Origem
    const origin = req.headers.origin || req.headers.referer || '';
    if (!origin.includes("vercel.app") && !origin.includes("localhost") && !origin.includes("miccorretores.com.br")) {
        return res.status(403).json({ error: "Acesso bloqueado. Origem não autorizada." });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

        const { locacao_id, mes_ref, acao } = req.body || {};

    if (!['consultar_vencida', 'conferir_previa', 'excluir'].includes(acao)) {
        return res.status(400).json({
            error: 'Ação de cobrança desconhecida. Nenhuma cobrança foi alterada.'
        });
    }

    if (!locacao_id || !mes_ref) {
        return res.status(400).json({ error: 'Faltam parâmetros (locacao_id ou mes_ref)' });
    }

    const ASAAS_KEY = process.env.ASAAS_API_KEY;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    const SUPABASE_URL = 'https://uztsmkhlvoemjbbyebcr.supabase.co'; // URL extraída dos seus outros códigos

    try {
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
