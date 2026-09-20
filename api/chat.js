export default async function handler(req, res) {
    // ==========================================
    // 1. TRAVA DE SEGURANÇA (Adicionado agora)
    // ==========================================
    const origin = req.headers.origin || req.headers.referer || '';
    
    // IMPORTANTE: Substitua 'seusite.vercel.app' pelo link real da sua aplicação na Vercel
    if (!origin.includes("seusite.vercel.app") && !origin.includes("localhost")) {
        return res.status(403).json({ error: "Acesso não autorizado. Tentativa bloqueada." });
    }

    // ==========================================
    // 2. SEU CÓDIGO ORIGINAL CONTINUA AQUI
    // ==========================================
    // if (req.method !== 'POST') { ... }
    // const prompt = req.body.message;
    // ...
}
