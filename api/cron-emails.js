export default async function handler(req, res) {
    // 1. Fechadura de segurança da Vercel (impede execuções externas não autorizadas)
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    try {
        const SUPABASE_KEY = process.env.SUPABASE_KEY;
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

        if (!SUPABASE_KEY || !RESEND_API_KEY || !ASAAS_API_KEY) {
            throw new Error("Falta configurar variáveis de ambiente na Vercel (SUPABASE_KEY, RESEND_API_KEY ou ASAAS_API_KEY).");
        }

        // 2. Buscar no Supabase os e-mails que ainda não foram totalmente enviados
        const supabaseUrl = `https://dgadztmmarvbjcouvrnp.supabase.co/rest/v1/disparos_email?or=(status_disparo_1.eq.false,status_disparo_2.eq.false,status_disparo_3.eq.false)`;
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

        // 3. Analisar cada inquilino pendente
        for (const item of pendentes) {
            // Verificar no Asaas se a fatura JÁ FOI PAGA
            const asaasRes = await fetch(`https://api.asaas.com/v3/payments?externalReference=${item.locacao_id}||${item.mes_ref}`, {
                headers: { 'access_token': ASAAS_API_KEY }
            });
            const asaasData = await asaasRes.json();
            
            if (asaasData.data && asaasData.data.length > 0) {
                const statusFatura = asaasData.data[0].status;
                if (statusFatura === 'RECEIVED' || statusFatura === 'CONFIRMED') {
                    // Cancela envios futuros atualizando tudo para TRUE
                    await fetch(`https://dgadztmmarvbjcouvrnp.supabase.co/rest/v1/disparos_email?id=eq.${item.id}`, {
                        method: 'PATCH',
                        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status_disparo_1: true, status_disparo_2: true, status_disparo_3: true })
                    });
                    continue; 
                }
            }

            // Calcular a diferença de dias para o vencimento
            const dataVenc = new Date(item.data_vencimento);
            dataVenc.setHours(0, 0, 0, 0);
            const diffDias = Math.ceil((dataVenc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

            let deveEnviar = false;
            let campoAtualizar = '';
            let assuntoEmail = '';

            // Lógica dos 3 Momentos de Disparo
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

            // 4. Disparar e-mail via Resend
            if (deveEnviar) {
                const resendRes = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        from: 'M&IC Corretores de Imóveis <onboarding@resend.dev>', // Email de remetente obrigatório no plano gratuito
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

                // 5. Marcar no Supabase que este momento de aviso já foi enviado
                await fetch(`https://dgadztmmarvbjcouvrnp.supabase.co/rest/v1/disparos_email?id=eq.${item.id}`, {
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
