export default async function handler(req, res) {
    // Mantém a sua proteção original de origem, agora incluindo seu domínio
    const origin = req.headers.origin || req.headers.referer || '';
    if (!origin.includes("vercel.app") && !origin.includes("localhost") && !origin.includes("miccorretores.com.br")) {
        return res.status(403).json({ error: "Acesso bloqueado. Origem não autorizada." });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const { nomeInquilino, cpfInquilino, emailInquilino, valor, vencimento, descricao, externalReference, reciboBase64 } = req.body;
    
    const API_KEY = process.env.ASAAS_API_KEY; 
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

    try {
        // 0. Trava contra duplicidade: verifica se já existe fatura ativa para este imóvel/mês
        const checkExisting = await fetch(`https://api.asaas.com/v3/payments?externalReference=${encodeURIComponent(externalReference)}`, {
            method: 'GET',
            headers: { 'access_token': API_KEY }
        });
        const existingData = await checkExisting.json();
        if (existingData.data && existingData.data.length > 0) {
            const faturaAtiva = existingData.data.find(p => !p.deleted && p.status !== 'REFUNDED');
            if (faturaAtiva && faturaAtiva.invoiceUrl) {
                return res.status(200).json({
                    urlFatura: faturaAtiva.invoiceUrl,
                    faturaId: faturaAtiva.id
                });
            }
        }

        // 1. Procurar ou Criar o Cliente no Asaas (Para não duplicar cadastros)
        let asaasCustomerId;
        const searchCustomer = await fetch(`https://api.asaas.com/v3/customers?cpfCnpj=${cpfInquilino}`, {
            method: 'GET',
            headers: { 'access_token': API_KEY }
        });
        const searchResult = await searchCustomer.json();
        
        if (searchResult.data && searchResult.data.length > 0) {
            asaasCustomerId = searchResult.data[0].id;
        } else {
            const createCustomer = await fetch('https://api.asaas.com/v3/customers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'access_token': API_KEY },
                body: JSON.stringify({ name: nomeInquilino, cpfCnpj: cpfInquilino })
            });
            const createResult = await createCustomer.json();
            if (!createCustomer.ok) throw new Error('Falha ao criar cliente no Asaas.');
            asaasCustomerId = createResult.id;
        }

        // 2. Criar a Cobrança no Asaas
        const createPayment = await fetch('https://api.asaas.com/v3/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'access_token': API_KEY },
            body: JSON.stringify({
                customer: asaasCustomerId,
                billingType: "PIX",
                value: valor,
                dueDate: vencimento,
                description: descricao,
                externalReference: externalReference
            })
        });
        const paymentResult = await createPayment.json();
        if (!createPayment.ok) throw new Error(paymentResult.errors[0].description);

        const linkFatura = paymentResult.invoiceUrl;
        const ids = externalReference.split('||'); 
        const locacao_id = ids[0];
        const mes_ref = ids[1];

        // 3. Gravar na nova tabela 'disparos_email' do Supabase
        if (reciboBase64 && emailInquilino) {
             const supabaseUrl = `https://uztsmkhlvoemjbbyebcr.supabase.co/rest/v1/disparos_email`;
             await fetch(supabaseUrl, {
                 method: 'POST',
                 headers: { 
                     'apikey': SUPABASE_KEY, 
                     'Authorization': `Bearer ${SUPABASE_KEY}`,
                     'Content-Type': 'application/json',
                     'Prefer': 'return=minimal'
                 },
                 body: JSON.stringify({
                     locacao_id: locacao_id,
                     mes_ref: mes_ref,
                     email_inquilino: emailInquilino,
                     nome_inquilino: nomeInquilino,
                     valor_total: valor,
                     link_asaas: linkFatura,
                     data_vencimento: vencimento,
                     recibo_base64: reciboBase64
                 })
             });
        }

        return res.status(200).json({ urlFatura: linkFatura, faturaId: paymentResult.id });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
