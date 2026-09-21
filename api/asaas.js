export default async function handler(req, res) {
    // 1. TRAVA DE SEGURANÇA CONTRA INVASORES
    const origin = req.headers.origin || req.headers.referer || '';
    if (!origin.includes("vercel.app") && !origin.includes("localhost")) {
        return res.status(403).json({ error: "Acesso bloqueado. Origem não autorizada." });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: "Método não permitido" });

    // 2. RECEBE OS DADOS DO NOSSO APLICATIVO
    const { nomeInquilino, cpfInquilino, valor, vencimento, descricao } = req.body;
    
    // Puxa a chave secreta guardada no cofre da Vercel
    const API_KEY = process.env.ASAAS_API_KEY;

    try {
        // 3. PASSO A: CADASTRAR O CLIENTE NO ASAAS
        const resCliente = await fetch('https://api.asaas.com/v3/customers', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'access_token': API_KEY 
            },
            body: JSON.stringify({ 
                name: nomeInquilino, 
                cpfCnpj: cpfInquilino 
            })
        });
        
        const dataCliente = await resCliente.json();

        // Se der erro (ex: CPF inválido), devolve o erro para a tela
        if (dataCliente.errors) {
            return res.status(400).json({ error: dataCliente.errors[0].description });
        }

        const idCliente = dataCliente.id;

        // 4. PASSO B: GERAR A COBRANÇA (PIX)
        const resCobranca = await fetch('https://api.asaas.com/v3/payments', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'access_token': API_KEY 
            },
            body: JSON.stringify({
                customer: idCliente,
                billingType: 'PIX', // Pode mudar para 'BOLETO' futuramente
                value: valor,
                dueDate: vencimento,
                description: descricao
            })
        });
        
        const dataCobranca = await resCobranca.json();

        if (dataCobranca.errors) {
            return res.status(400).json({ error: dataCobranca.errors[0].description });
        }

        // 5. SUCESSO! DEVOLVE O LINK DE PAGAMENTO OFICIAL DO ASAAS
        return res.status(200).json({ urlFatura: dataCobranca.invoiceUrl });

    } catch (error) {
        return res.status(500).json({ error: "Erro interno de comunicação com o servidor bancário." });
    }
}
