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
    const prompt = `Você é um extrator especialista em contratos imobiliários de locação da M&IC.
Extraia com precisão as seguintes informações do contrato abaixo e responda EXCLUSIVAMENTE em formato JSON estrito, sem formatação markdown, sem crases:
{
  "proprietario": "Nome completo da pessoa ou empresa que aluga o imóvel (Locador)",
  "inquilino": "Nome completo de quem está alugando o imóvel (Locatário)",
  "endereco": "Endereço completo do imóvel locado",
  "data_inicio": "AAAA-MM-DD",
  "data_fim": "AAAA-MM-DD",
  "valor_aluguel": 0.00
}

Regras:
1. Se as datas estiverem no formato DD/MM/AAAA, converta para AAAA-MM-DD.
2. Em "valor_aluguel", informe apenas o número decimal (exemplo: 2500 ou 2500.00), sem 'R$'.
3. Não inclua CPF nem termos como "assinou como" nos nomes.

Texto do Contrato:
${text.substring(0, 20000)}`;

    const url = `[https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$](https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$){apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    });

    const data = await response.json();
    let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    // Limpeza de possíveis blocos de código
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(rawText);

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
