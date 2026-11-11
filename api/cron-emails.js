export default async function handler(req, res) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    try {
        const SUPABASE_URL = 'https://uztsmkhlvoemjbbyebcr.supabase.co';
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

        if (!SUPABASE_KEY || !RESEND_API_KEY || !ASAAS_API_KEY) {
            throw new Error("Falta configurar variáveis de ambiente na Vercel (SUPABASE_KEY, RESEND_API_KEY ou ASAAS_API_KEY).");
        }

        const supabaseUrl = `${SUPABASE_URL}/rest/v1/disparos_email?or=(status_disparo_1.eq.false,status_disparo_2.eq.false,status_disparo_3.eq.false)`;
        const resDb = await fetch(supabaseUrl, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        const pendentes = await resDb.json();

        if (!Array.isArray(pendentes)) {
            throw new Error("Erro de leitura no Supabase: " + JSON.stringify(pendentes));
        }

        if (pendentes.length === 0) {
            return res.status(200).json({ message: 'Nenhum e-mail pendente.' });
        }

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        let disparosFeitos = 0;

        for (const item of pendentes) {
            const asaasRes = await fetch(`https://api.asaas.com/v3/payments?externalReference=${encodeURIComponent(item.locacao_id + '||' + item.mes_ref)}`, {
                headers: { 'access_token': ASAAS_API_KEY }
            });
            if (!asaasRes.ok) continue;
            const asaasData = await asaasRes.json();
            if (!Array.isArray(asaasData?.data) || asaasData.hasMore) continue;

            const referencia = item.locacao_id + '||' + item.mes_ref;
            const ativas = asaasData.data.filter(f => !f.deleted && f.status !== 'REFUNDED');
            if (ativas.length !== 1) continue;

            const fatura = ativas[0];
            if (!fatura.invoiceUrl || fatura.invoiceUrl !== item.link_asaas ||
                fatura.externalReference !== referencia) continue;

            if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(fatura.status)) {
                await fetch(`${SUPABASE_URL}/rest/v1/disparos_email?id=eq.${item.id}`, {
                    method: 'PATCH',
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status_disparo_1: true, status_disparo_2: true, status_disparo_3: true })
                });
                continue;
            }

            if (!['PENDING', 'OVERDUE'].includes(fatura.status) ||
                fatura.dueDate !== item.data_vencimento ||
                Math.round(Number(fatura.value) * 100) !== Math.round(Number(item.valor_total) * 100)) continue;

            const [anoV, mesV, diaV] = String(item.data_vencimento).split('-').map(Number);
            const dataVenc = new Date(anoV, mesV - 1, diaV);
            dataVenc.setHours(0, 0, 0, 0);
            const diffDias = Math.ceil((dataVenc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

            let deveEnviar = false;
            let campoAtualizar = '';
            let assuntoEmail = '';

            if (item.status_disparo_1 === false) {
                deveEnviar = true;
                campoAtualizar = 'status_disparo_1';
                assuntoEmail = 'Sua nova cobrança de aluguel já está disponível - M&IC';
            } else if (diffDias === 2 && item.status_disparo_2 === false) {
                deveEnviar = true;
                campoAtualizar = 'status_disparo_2';
                assuntoEmail = 'Lembrete: O seu aluguel vence em 2 dias - M&IC';
            } else if (diffDias === 0 && item.status_disparo_3 === false) {
                deveEnviar = true;
                campoAtualizar = 'status_disparo_3';
                assuntoEmail = 'Aviso de Vencimento: O seu aluguel vence HOJE - M&IC';
            }

            if (deveEnviar) {
                const resendRes = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        from: 'M&IC Cobrança <cobranca@miccorretores.com.br>',
                        to: item.email_inquilino,
                        subject: assuntoEmail,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                                <h2>Olá, ${item.nome_inquilino}!</h2>
                                <p>${assuntoEmail}</p>
                                <p>Pode pagar diretamente através do link seguro do seu banco (Asaas) clicando no botão abaixo:</p>
                                <a href="${item.link_asaas}" style="display: inline-block; padding: 12px 24px; background-color: #001e60; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 16px 0;">Pagar Fatura Oficial</a>
                                <p>Abaixo, segue o recibo descritivo dos valores deste mês:</p>
                                <img src="${item.recibo_base64}" alt="Recibo M&IC" style="max-width: 100%; border: 1px solid #ddd; border-radius: 8px; margin-top: 20px;" />
                                <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;" />
                                <p style="font-size: 12px; color: #888;">M&IC Corretores de Imóveis<br>Gestão de Locação Automatizada</p>
                            </div>
                        `
                    })
                });

                if (!resendRes.ok) {
                    const resendErro = await resendRes.json();
                    throw new Error("Erro na API da Resend: " + JSON.stringify(resendErro));
                }

                await fetch(`${SUPABASE_URL}/rest/v1/disparos_email?id=eq.${item.id}`, {
                    method: 'PATCH',
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ [campoAtualizar]: true })
                });
                disparosFeitos++;
            }
        }

        return res.status(200).json({ success: true, disparos: disparosFeitos });
    } catch (error) {
        console.error("ERRO CRÍTICO DETETADO:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
