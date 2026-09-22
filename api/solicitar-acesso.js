export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const { email_solicitante } = req.body;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    // Link que você vai clicar para aprovar direto do e-mail
    const linkAprovacao = `https://adm.miccorretores.com.br/api/aprovar-acesso?email=${encodeURIComponent(email_solicitante)}`;

    try {
        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: 'M&IC Sistema <cobranca@miccorretores.com.br>',
                to: 'chalfouncorretor@gmail.com', // O seu e-mail
                subject: '🚨 Novo Pedido de Acesso - M&IC Gestão',
                html: `
                    <div style="font-family: sans-serif; color: #1e293b;">
                        <h2 style="color: #c59b27;">Novo Cadastro Pendente</h2>
                        <p>Olá Mário,</p>
                        <p>O usuário <b>${email_solicitante}</b> acabou de se cadastrar no sistema e aguarda a sua liberação.</p>
                        <br>
                        <a href="${linkAprovacao}" style="background-color: #16a34a; color: white; padding: 14px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">
                            ✅ CLIQUE AQUI PARA APROVAR O ACESSO
                        </a>
                        <br><br>
                        <p style="font-size: 0.85rem; color: #64748b;">Se você não reconhece este e-mail, apenas ignore esta mensagem. O acesso continuará bloqueado.</p>
                    </div>
                `
            })
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
