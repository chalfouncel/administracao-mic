export default async function handler(req, res) {
    // 1. Trava de segurança da Origem
    const origin = req.headers.origin || req.headers.referer || '';
    if (!origin.includes("vercel.app") && !origin.includes("localhost") && !origin.includes("miccorretores.com.br")) {
        return res.status(403).json({ error: "Acesso bloqueado. Origem não autorizada." });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const { locacao_id, mes_ref } = req.body;

    if (!locacao_id || !mes_ref) {
        return res.status(400).json({ error: 'Faltam parâmetros (locacao_id ou mes_ref)' });
    }

    const ASAAS_KEY = process.env.ASAAS_API_KEY;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;
    const SUPABASE_URL = 'https://uztsmkhlvoemjbbyebcr.supabase.co'; // URL extraída dos seus outros códigos

    try {
        const externalReference = `${locacao_id}||${mes_ref}`;

        // ==========================================
        // ETAPA 1: EXCLUIR NO ASAAS (Se existir)
        // ==========================================
        // Busca a cobrança no Asaas pelo externalReference
        const searchRes = await fetch(`https://api.asaas.com/v3/payments?externalReference=${externalReference}`, {
            headers: { 'access_token': ASAAS_KEY }
        });
        const searchData = await searchRes.json();

        if (searchData.data && searchData.data.length > 0) {
            const pagamentoAsaas = searchData.data[0];
            
            // Trava de segurança: Se já estiver pago, NÃO DEIXA EXCLUIR!
            if (pagamentoAsaas.status === 'RECEIVED' || pagamentoAsaas.status === 'CONFIRMED') {
                return res.status(403).json({ error: 'Esta cobrança já foi paga e não pode ser excluída.' });
            }

            // Exclui a cobrança no Asaas
            await fetch(`https://api.asaas.com/v3/payments/${pagamentoAsaas.id}`, {
                method: 'DELETE',
                headers: { 'access_token': ASAAS_KEY }
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

            // Remove o mês específico do JSON de controle
            delete statusCobranca[mes_ref];

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
