export default async function handler(req, res) {
    // 1. Verifica se é POST
    if (req.method !== 'POST') {
        return res.status(405).send('Método não permitido');
    }

    try {
        const payload = req.body;
        console.log("🔔 Webhook Asaas Recebido. Evento:", payload?.event);

        if (payload?.event === 'PAYMENT_RECEIVED' || payload?.event === 'PAYMENT_CONFIRMED') {
            const extRef = payload.payment?.externalReference;
            console.log("📌 Referência Externa:", extRef);

            if (!extRef || typeof extRef !== 'string') {
                console.log("⚠️ Ignorado: Sem referência externa válida.");
                return res.status(200).send('Ignorado');
            }

            const [idReg, mesRef] = extRef.split('||');
            console.log(`🔄 Atualizando Locação ID: ${idReg} | Mês: ${mesRef}`);

            const SUPABASE_URL = 'https://dgadztmmarvbjcouvrnp.supabase.co';
            const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

            if (!SUPABASE_KEY) {
                throw new Error("SUPABASE_SERVICE_KEY não encontrada nas variáveis de ambiente!");
            }

            // 2. Busca a locação
            const resGet = await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${idReg}`, {
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
            });
            
            if (!resGet.ok) throw new Error(`Erro ao buscar locação: ${resGet.statusText}`);
            const dataGet = await resGet.json();

            // 3. Atualiza o status se encontrar
            if (dataGet && dataGet.length > 0) {
                let statusCobranca = {}; 
                try { 
                    statusCobranca = JSON.parse(dataGet[0].status_cobranca || '{}'); 
                } catch(e) {
                    console.log("Aviso: status_cobranca anterior não era um JSON válido. Criando um novo.");
                }
                
                statusCobranca[mesRef] = 'recebida'; // Pinta de Verde!

                const resPatch = await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${idReg}`, {
                    method: 'PATCH',
                    headers: { 
                        'Content-Type': 'application/json', 
                        'apikey': SUPABASE_KEY, 
                        'Authorization': `Bearer ${SUPABASE_KEY}` 
                    },
                    body: JSON.stringify({ status_cobranca: JSON.stringify(statusCobranca) })
                });

                if (!resPatch.ok) throw new Error(`Erro ao salvar no Supabase: ${resPatch.statusText}`);
                console.log("✅ Sucesso! Status de cobrança atualizado para 'recebida'.");
            } else {
                console.log("❌ Locação não encontrada no banco com esse ID.");
            }
        }
        
        // Retorna 200 para o Asaas saber que deu tudo certo e tirar a penalidade
        return res.status(200).json({ received: true });

    } catch (error) {
        console.error("🚨 ERRO NO WEBHOOK:", error.message);
        // Mesmo dando erro no nosso lado, retornamos 200 pro Asaas não travar a fila de novo.
        // O erro ficará registrado no painel da Vercel para você ver depois.
        return res.status(200).json({ error: "Erro interno tratado", details: error.message });
    }
}
