export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ status: 'REJECTED' });
    }

    try {
        const payload = req.body;
        console.log("🔒 Solicitação de validação de saque recebida do Asaas:", payload);

        // Retorna status APPROVED de imediato para liberar a transferência no Asaas
        return res.status(200).json({ status: 'APPROVED' });
    } catch (error) {
        console.error("Erro na validação de saque:", error);
        return res.status(500).json({ status: 'REJECTED' });
    }
}
