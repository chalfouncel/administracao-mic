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
    const prompt = `Você é um auditor pericial de contratos de locação da M&IC.
Extraia os dados contratuais com absoluta precisão e responda EXCLUSIVAMENTE em formato JSON estrito (sem markdown, sem crases):
{
  "proprietario": "Nome completo do Locador",
  "inquilino": "Nome completo do Locatário",
  "endereco": "Endereço completo do imóvel locado",
  "data_inicio": "AAAA-MM-DD",
  "data_fim": "AAAA-MM-DD",
  "valor_aluguel": 0.00
}

REGRAS OBRIGATÓRIAS:
1. "proprietario": Localize no preâmbulo quem é o "LOCADOR(A)". Exemplo: Rodrigo dos Santos de Oliveira.
2. "inquilino": Localize no preâmbulo quem é o "LOCATÁRIO(A)". Exemplo: Cristiano Nogueira da Costa.
   ATENÇÃO: NUNCA coloque os corretores "Mario Chalfoun Junior" ou "Ivy Carla" como inquilino.
3. "endereco": Endereço completo sem prefixo "na" ou "no". Corrija erros de encoding como "PraÁa" para "Praça", "n∫" para "nº".
4. "data_inicio" e "data_fim": Converta as datas da CLÁUSULA PRIMEIRA para o padrão AAAA-MM-DD.
5. "valor_aluguel": Valor numérico puro da CLÁUSULA SEGUNDA (exemplo: 1000.00).

Texto do Contrato:
${text.substring(0, 25000)}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.0,
          responseMimeType: "application/json"
        }
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
