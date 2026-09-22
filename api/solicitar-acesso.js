export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const { email_solicitante } = req.body;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    try {
        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: 'M&IC Sistema <cobranca@miccorretores.com.br>',
                to: 'chalfouncorretor@gmail.com', // O seu e-mail que receberá o alerta
                subject: '🚨 Novo Pedido de Acesso - M&IC Gestão',
                html: `<p>Olá Mário,</p><p>O e-mail <b>${email_solicitante}</b> acabou de se cadastrar no sistema.</p><p>Para liberar o acesso ao QR Code de segurança e ao painel, acesse o Supabase, vá na tabela <b>usuarios_aprovados</b> e mude o status desse e-mail de "pendente" para <b>"aprovado"</b>.</p>`
            })
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
