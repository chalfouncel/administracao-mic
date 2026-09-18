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
    const prompt = `Você é um auditor pericial de contratos de locação residencial da imobiliária M&IC.
Extraia com precisão cirúrgica os dados deste contrato brasileiro da Clicksign.

REGRAS OBRIGATÓRIAS:
1. "proprietario": É a pessoa indicada no cabeçalho após "LOCADOR(A):". Ignore corretores e procuradores.
2. "inquilino": É a pessoa indicada no cabeçalho após "LOCATÁRIO(A):". 
   ATENÇÃO: NUNCA confunda com o corretor "Mario Chalfoun Junior" ou "Ivy Carla". O inquilino é quem está alugando para residir.
3. "endereco": Endereço completo após "IMÓVEL:". Corrija qualquer erro de acentuação como "PraÁa" para "Praça", "n∫" para "nº".
4. "data_inicio" e "data_fim": Extraia da CLÁUSULA PRIMEIRA ("com início em DD/MM/AAAA até... DD/MM/AAAA"). Converta estritamente para formato AAAA-MM-DD.
5. "valor_aluguel": Extraia da CLÁUSULA SEGUNDA ("estabelecido em R$ XXXX,XX"). Retorne somente o número decimal (ex: 1000.00).

Responda EXCLUSIVAMENTE em formato JSON estrito, sem crases e sem markdown:
{
  "proprietario": "Nome completo do Locador",
  "inquilino": "Nome completo do Locatário",
  "endereco": "Endereço corrigido em Português do Brasil",
  "data_inicio": "AAAA-MM-DD",
  "data_fim": "AAAA-MM-DD",
  "valor_aluguel": 0.00
}

TEXTO DO CONTRATO:
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
    const parsed = JSON.parse(rawText);

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
