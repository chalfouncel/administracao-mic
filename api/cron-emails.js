export default async function handler(req, res) {
    // Segurança: Garantir que a Vercel chamou este Cron e não um curioso
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    const SUPABASE_KEY = process.env.SUPABASE_KEY;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

    try {
        // 1. Buscar no Supabase os e-mails que ainda não foram totalmente enviados
        const supabaseUrl = `https://dgadztmmarvbjcouvrnp.supabase.co/rest/v1/disparos_email?or=(status_disparo_1.eq.false,status_disparo_2.eq.false,status_disparo_3.eq.false)`;
        const resDb = await fetch(supabaseUrl, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        const pendentes = await resDb.json();

        if (!pendentes || pendentes.length === 0) {
            return res.status(200).json({ message: 'Nenhum e-mail pendente.' });
        }

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        let disparosFeitos = 0;

        // 2. Analisar cada inquilino pendente
        for (const item of pendentes) {
            // Verificar no Asaas se a fatura JÁ FOI PAGA (se sim, cancelamos os próximos envios)
            const asaasRes = await fetch(`https://api.asaas.com/v3/payments?externalReference=${item.locacao_id}||${item.mes_ref}`, {
                headers: { 'access_token': ASAAS_API_KEY }
            });
            const asaasData = await asaasRes.json();
            
            if (asaasData.data && asaasData.data.length > 0) {
                const statusFatura = asaasData.data[0].status;
                if (statusFatura === 'RECEIVED' || statusFatura === 'CONFIRMED') {
                    // Mata a régua de cobrança atualizando tudo para TRUE
                    await fetch(`https://dgadztmmarvbjcouvrnp.supabase.co/rest/v1/disparos_email?id=eq.${item.id}`, {
                        method: 'PATCH',
                        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status_disparo_1: true, status_disparo_2: true, status_disparo_3: true })
                    });
                    continue; // Pula para o próximo inquilino
                }
            }

            // Calcular a diferença de dias
            const dataVenc = new Date(item.data_vencimento);
            dataVenc.setHours(0, 0, 0, 0);
            const diffTime = dataVenc.getTime() - hoje.getTime();
            const diffDias = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            let deveEnviar = false;
            let campoAtualizar = '';
            let assuntoEmail = '';

            // Lógica dos 3 Momentos:
            if (item.status_disparo_1 === false) {
                // Momento 1: Acabou de ser gerado (Primeiro aviso)
                deveEnviar = true;
                campoAtualizar = 'status_disparo_1';
                assuntoEmail = 'Sua nova cobrança de aluguel já está disponível - M&IC';
            } else if (diffDias === 2 && item.status_disparo_2 === false) {
                // Momento 2: Faltam 2 dias
                deveEnviar = true;
                campoAtualizar = 'status_disparo_2';
                assuntoEmail = 'Lembrete: O seu aluguel vence em 2 dias - M&IC';
            } else if (diffDias === 0 && item.status_disparo_3 === false) {
                // Momento 3: É hoje!
                deveEnviar = true;
                campoAtualizar = 'status_disparo_3';
                assuntoEmail = 'Aviso de Vencimento: O seu aluguel vence HOJE - M&IC';
            }

            // 3. Disparar via Resend
            if (deveEnviar) {
                const resendRes = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        from: 'M&IC Corretores <onboarding@resend.dev>', // Restrição da Resend Gratuita
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

                if (resendRes.ok) {
                    // Atualiza o banco para não enviar repetido
                    await fetch(`https://dgadztmmarvbjcouvrnp.supabase.co/rest/v1/disparos_email?id=eq.${item.id}`, {
                        method: 'PATCH',
                        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ [campoAtualizar]: true })
                    });
                    disparosFeitos++;
                }
            }
        }

        return res.status(200).json({ success: true, disparos: disparosFeitos });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
