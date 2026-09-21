export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Método não permitido');

    const payload = req.body;
    
    // O Asaas avisa: "Recebemos o dinheiro!"
    if (payload.event === 'PAYMENT_RECEIVED' || payload.event === 'PAYMENT_CONFIRMED') {
        const extRef = payload.payment?.externalReference;
        if (!extRef) return res.status(200).send('Ignorado: sem referência externa.');

        // Separa o crachá: Ex: "12||2026-10"
        const [idReg, mesRef] = extRef.split('||');

        const SUPABASE_URL = 'https://dgadztmmarvbjcouvrnp.supabase.co';
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // Usa a chave mestra para furar o RLS

        // 1. Lê como estava o status do contrato
        const resGet = await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${idReg}&select=status_cobranca`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        const dataGet = await resGet.json();
        if (!dataGet || dataGet.length === 0) return res.status(200).send('Contrato não encontrado');

        let statusObj = {};
        try { statusObj = JSON.parse(dataGet[0].status_cobranca || '{}'); } catch(e){}

        // 2. Muda o status exato desse mês para "recebida" (O que vai pintar de verde)
        statusObj[mesRef] = 'recebida';

        // 3. Salva no banco de dados silenciosamente
        await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${idReg}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
            body: JSON.stringify({ status_cobranca: JSON.stringify(statusObj) })
        });
    }

    // Retorna OK rápido para o Asaas não achar que deu erro
    return res.status(200).json({ received: true });
}
