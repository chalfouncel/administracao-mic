export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada na Vercel.' });
  }

  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Texto do contrato não fornecido.' });
  }

  try {
    const prompt = `Você é um extrator especialista em contratos imobiliários de locação da M&IC.
Analise o texto a seguir e extraia as seguintes informações obrigatórias em formato JSON estrito (sem markdown, sem crases):
{
  "proprietario": "Nome completo do Locador",
  "inquilino": "Nome completo do Locatário",
  "endereco": "Endereço completo do imóvel locado",
  "data_inicio": "AAAA-MM-DD",
  "data_fim": "AAAA-MM-DD",
  "valor_aluguel": 0.00
}

Caso alguma data esteja no padrão brasileiro DD/MM/AAAA, converta para AAAA-MM-DD.
No valor_aluguel retorne apenas número decimal (exemplo: 2500.00).

Texto do contrato:
${text.substring(0, 15000)}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    const data = await response.json();
    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(rawJson);

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
