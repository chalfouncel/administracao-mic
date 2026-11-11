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
        if (!checkExisting.ok) {
            return res.status(502).json({
                error: 'Não foi possível consultar as faturas no Asaas. Tente novamente antes de emitir.'
            });
        }

        const existingData = await checkExisting.json();

        if (!Array.isArray(existingData?.data) || existingData.hasMore) {
            return res.status(409).json({
                error: 'A consulta de faturas está incompleta. Confira a competência no Asaas.'
            });
        }

        const faturas = existingData.data.filter(
            fatura => !fatura.deleted && fatura.status !== 'REFUNDED'
        );

        if (faturas.length > 1) {
            return res.status(409).json({
                error: 'Há mais de uma fatura para este imóvel e mês. Confira no Asaas antes de emitir.'
            });
        }

        if (faturas.length === 1) {
            const fatura = faturas[0];

            if (!['PENDING', 'OVERDUE'].includes(fatura.status)) {
                return res.status(409).json({
                    error: `Já existe uma fatura com situação ${fatura.status}. Confira no Asaas antes de emitir.`
                });
            }

            const mesmoValor =
                Math.round(Number(fatura.value) * 100) ===
                Math.round(Number(valor) * 100);

            if (!fatura.id || !fatura.invoiceUrl ||
                fatura.externalReference !== externalReference ||
                fatura.dueDate !== vencimento || !mesmoValor) {
                return res.status(409).json({
                    error: 'A fatura existente não corresponde à emissão solicitada. Confira o valor e o vencimento.'
                });
            }

            return res.status(200).json({
                urlFatura: fatura.invoiceUrl,
                faturaId: fatura.id
            });
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
