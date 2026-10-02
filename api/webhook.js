export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Método não permitido');

    try {
        const payload = req.body;
        const SUPABASE_URL = 'https://uztsmkhlvoemjbbyebcr.supabase.co';
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
        const RESEND_KEY = process.env.RESEND_API_KEY;

        // 1. QUANDO O INQUILINO PAGA (Atualiza cobrança para verde)
        if (payload?.event === 'PAYMENT_RECEIVED' || payload?.event === 'PAYMENT_CONFIRMED') {
            const extRef = payload.payment?.externalReference;
            if (extRef && typeof extRef === 'string') {
                const [idReg, mesRef] = extRef.split('||');
                const resGet = await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${idReg}`, {
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
                });
                const dataGet = await resGet.json();
                if (dataGet && dataGet.length > 0) {
                    let statusCobranca = {};
                    try { statusCobranca = JSON.parse(dataGet[0].status_cobranca || '{}'); } catch(e){}
                    statusCobranca[mesRef] = 'recebida';

                    await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${idReg}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
                        body: JSON.stringify({ status_cobranca: JSON.stringify(statusCobranca) })
                    });
                }
            }
        }

        // 2. QUANDO O REPASSE/PIX É LIQUIDADO (Dispara comprovantes por e-mail)
        if (payload?.event === 'TRANSFER_DONE') {
            const transfer = payload.transfer;
            const comprovanteUrl = transfer?.transactionReceiptUrl;
            const valorFmt = transfer?.value ? transfer.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
            const desc = transfer?.description || '';

            const isCondominio = desc.toLowerCase().includes('condomínio') || desc.toLowerCase().includes('condominio');

            // Cópia sempre para a corretora
            let destinatarios = ['chalfouncorretor@gmail.com'];

            let assunto = isCondominio 
                ? `[Comprovante] Pagamento de Condomínio Realizado - ${desc}`
                : `[Comprovante] Repasse de Locação Realizado - ${desc}`;

            let corpoHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <h2 style="color: #c59b27; margin-bottom: 8px;">M&IC Corretores</h2>
                    <p style="font-size: 15px; color: #1e293b;">
                        ${isCondominio 
                            ? 'O pagamento da <strong>taxa de condomínio</strong> foi liquidado via Pix com sucesso. Segue comprovante para prestação de contas:' 
                            : 'O <strong>repasse de aluguel</strong> foi transferido com sucesso.'}
                    </p>
                    
                    <div style="background: #f8fafc; padding: 14px; border-radius: 6px; margin: 16px 0; border-left: 4px solid #16a34a;">
                        <p style="margin: 0; font-size: 13px; color: #64748b;">Identificação:</p>
                        <p style="margin: 2px 0 10px 0; font-weight: bold; color: #1e293b;">${desc}</p>
                        <p style="margin: 0; font-size: 13px; color: #64748b;">Valor Transferido:</p>
                        <p style="margin: 2px 0 0 0; font-size: 20px; font-weight: 900; color: #16a34a;">${valorFmt}</p>
                    </div>

                    <a href="${comprovanteUrl}" target="_blank" style="display: block; text-align: center; background: #1a1c20; color: #d4af37; padding: 12px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 15px;">
                        📄 Visualizar Comprovante Bancário Oficial
                    </a>
                    
                    <p style="font-size: 12px; color: #94a3b8; margin-top: 20px; text-align: center;">
                        M&IC Gestão Imobiliária • Notificação automática do sistema.
                    </p>
                </div>
            `;

            if (RESEND_KEY && comprovanteUrl) {
                await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${RESEND_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: 'M&IC Gestão <financeiro@miccorretores.com.br>',
                        to: destinatarios,
                        subject: assunto,
                        html: corpoHtml
                    })
                }).catch(err => console.error("Erro envio Resend:", err));
            }
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        console.error("🚨 ERRO NO WEBHOOK:", error.message);
        return res.status(200).json({ error: "Erro interno tratado", details: error.message });
    }
}
