export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).send('Método não permitido');

    const { email } = req.query;
    if (!email) return res.status(400).send('E-mail não fornecido');

    const SUPABASE_URL = 'https://dgadztmmarvbjcouvrnp.supabase.co';
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_aprovados?email=eq.${encodeURIComponent(email)}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ status: 'aprovado' })
        });

        if (!response.ok) {
            const err = await response.text();
            return res.status(500).send(`Erro ao aprovar: ${err}`);
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(`
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                <h2 style="color: #166534;">✅ Acesso Aprovado com Sucesso!</h2>
                <p>O usuário <b>${email}</b> já tem permissão para configurar o código de segurança e acessar o sistema.</p>
                <p style="color: #64748b; margin-top: 20px;">Você pode fechar esta aba.</p>
            </div>
        `);
    } catch (error) {
        return res.status(500).send(`Falha no servidor: ${error.message}`);
    }
}
