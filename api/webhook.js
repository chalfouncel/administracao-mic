export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Método não permitido');

    const payload = req.body;
    if (payload.event === 'PAYMENT_RECEIVED' || payload.event === 'PAYMENT_CONFIRMED') {
        const extRef = payload.payment?.externalReference;
        if (!extRef) return res.status(200).send('Ignorado');

        const [idReg, mesRef] = extRef.split('||');
        const SUPABASE_URL = 'https://dgadztmmarvbjcouvrnp.supabase.co';
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

        const resGet = await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${idReg}`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        const dataGet = await resGet.json();
        if (dataGet && dataGet.length > 0) {
            let statusCobranca = {}; try { statusCobranca = JSON.parse(dataGet[0].status_cobranca || '{}'); } catch(e){}
            statusCobranca[mesRef] = 'recebida'; // Pinta de Verde!
            await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${idReg}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
                body: JSON.stringify({ status_cobranca: JSON.stringify(statusCobranca) })
            });
        }
    }
    return res.status(200).json({ received: true });
}
