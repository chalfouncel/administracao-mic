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
    return res.status(400).json({ error: 'Texto não fornecido.' });
  }

  try {
    const prompt = `Você é um sistema extrator de dados de contratos de locação.
Leia o texto fornecido e extraia as seguintes informações:
1. LOCADOR: Nome da pessoa (excluir CPF, estado civil, etc).
2. LOCATÁRIO: Nome da pessoa (excluir CPF, estado civil, etc).
3. IMÓVEL: Endereço completo.
4. DATA DE INÍCIO: Converter para AAAA-MM-DD.
5. DATA DE FIM: Converter para AAAA-MM-DD.
6. VALOR DO ALUGUEL: Apenas o número (ex: 1000.00).

Retorne APENAS um objeto JSON válido, sem formatação markdown ou textos adicionais, com as chaves exatas:
{"proprietario": "", "inquilino": "", "endereco": "", "data_inicio": "", "data_fim": "", "valor_aluguel": 0}

TEXTO DO CONTRATO:
${text.substring(0, 15000)}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });

    const data = await response.json();
    let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    return res.status(200).json(JSON.parse(rawText));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
