export default async function handler(req, res) {
    const origin = req.headers.origin || req.headers.referer || '';
    if (!origin.includes("vercel.app") && !origin.includes("localhost")) {
        return res.status(403).json({ error: "Acesso bloqueado. Origem não autorizada." });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: "Método não permitido" });

    // NOVIDADE: Recebemos a referência externa (ID do Contrato + Mês)
    const { nomeInquilino, cpfInquilino, valor, vencimento, descricao, externalReference } = req.body;
    const API_KEY = process.env.ASAAS_API_KEY;

    try {
        const resCliente = await fetch('https://api.asaas.com/v3/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'access_token': API_KEY },
            body: JSON.stringify({ name: nomeInquilino, cpfCnpj: cpfInquilino })
        });
        const dataCliente = await resCliente.json();
        if (dataCliente.errors) return res.status(400).json({ error: dataCliente.errors[0].description });

        const resCobranca = await fetch('https://api.asaas.com/v3/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'access_token': API_KEY },
            body: JSON.stringify({
                customer: dataCliente.id,
                billingType: 'PIX',
                value: valor,
                dueDate: vencimento,
                description: descricao,
                externalReference: externalReference // O Asaas vai nos devolver isso quando for pago!
            })
        });
        const dataCobranca = await resCobranca.json();
        if (dataCobranca.errors) return res.status(400).json({ error: dataCobranca.errors[0].description });

        return res.status(200).json({ urlFatura: dataCobranca.invoiceUrl });
    } catch (error) {
        return res.status(500).json({ error: "Erro interno." });
    }
}
