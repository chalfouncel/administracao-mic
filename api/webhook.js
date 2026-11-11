import { createHash, timingSafeEqual } from 'node:crypto';
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Método não permitido');

    const esperado = process.env.ASAAS_WEBHOOK_TOKEN;
    if (!esperado) return res.status(503).json({error:'Webhook sem token configurado.'});
    const recebido = req.headers['asaas-access-token'];
    const hash = texto => createHash('sha256').update(texto).digest();
    if (typeof recebido !== 'string' || !timingSafeEqual(hash(recebido),hash(esperado)))
        return res.status(401).json({error:'Webhook não autenticado.'});

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
                if (!resGet.ok) {
                    return res.status(503).json({
                        error: 'Falha ao consultar a locação. O pagamento precisa ser reprocessado.'
                    });
                }

                const dataGet = await resGet.json();

                if (!Array.isArray(dataGet) || dataGet.length !== 1) {
                    console.error('Locação não identificada para baixa', {
                        locacao_id: idReg,
                        mes_ref: mesRef
                    });

                    return res.status(503).json({
                        error: 'Não foi possível identificar a locação para registrar o pagamento.'
                    });
                }
                if (dataGet && dataGet.length > 0) {
                    let statusCobranca;

                    try {
                        statusCobranca = JSON.parse(dataGet[0].status_cobranca || '{}');

                        if (statusCobranca === null ||
                            typeof statusCobranca !== 'object' ||
                            Array.isArray(statusCobranca)) {
                            throw new Error('Formato inválido');
                        }
                    } catch (erro) {
                        console.error('Histórico de cobranças inválido', {
                            locacao_id: idReg,
                            mes_ref: mesRef
                        });

                        return res.status(503).json({
                            error: 'Histórico de cobranças inválido. Confira a locação antes de reprocessar.'
                        });
                    }
                    if (statusCobranca[mesRef] === 'transportada') {
                        console.warn('Pagamento em competência transportada: conciliar no Asaas.', {idReg, mesRef, fatura:payload.payment?.id});
                        return res.status(200).json({recebido:true, baixaAplicada:false, motivo:'Competência transportada'});
                    }
                    if (statusCobranca[mesRef + '_revisao']) {
                        return res.status(503).json({error:'Revisão em andamento. Reprocessar após a conciliação.'});
                    }
                    const idFaturaAtiva = statusCobranca[`${mesRef}_fatura_id`];
                    const idFaturaDoEvento = payload.payment?.id;

                    if (idFaturaAtiva && idFaturaDoEvento !== idFaturaAtiva) {
                        console.warn('Pagamento de outra fatura na mesma competência', {
                            locacao_id: idReg,
                            mes_ref: mesRef,
                            fatura_ativa: idFaturaAtiva,
                            fatura_do_evento: idFaturaDoEvento
                        });

                        return res.status(200).json({
                            recebido: true,
                            baixaAplicada: false,
                            motivo: 'Fatura diferente da ativa. Conferir pagamento no Asaas.'
                        });
                    }

                    statusCobranca[mesRef] = 'recebida';

                    const statusLido = dataGet[0].status_cobranca;
                    const filtros = new URLSearchParams({
                        id: `eq.${idReg}`,
                        status_cobranca: statusLido == null ? 'is.null' : `eq.${statusLido}`,
                        select: 'id'
                    });

                    const baixa = await fetch(`${SUPABASE_URL}/rest/v1/locacoes?${filtros}`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'apikey': SUPABASE_KEY,
                            'Authorization': `Bearer ${SUPABASE_KEY}`,
                            'Prefer': 'return=representation'
                        },
                        body: JSON.stringify({
                            status_cobranca: JSON.stringify(statusCobranca)
                        })
                    });

                    if (!baixa.ok) {
                        return res.status(503).json({
                            error: 'O banco não confirmou a baixa do pagamento.'
                        });
                    }

                    const registrosAtualizados = await baixa.json();

                    if (registrosAtualizados.length !== 1) {
                        return res.status(503).json({
                            error: 'O registro mudou durante a baixa. O evento precisa ser reprocessado.'
                        });
                    }
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
