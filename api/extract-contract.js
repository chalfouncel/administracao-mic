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
    const prompt = `Você é um perito em análise de contratos de locação imobiliária brasileira da M&IC.
Analise o texto contratual e retorne EXCLUSIVAMENTE um objeto JSON estrito (sem crases, sem markdown) com a seguinte estrutura:
{
  "proprietario": "Nome completo do Locador",
  "inquilino": "Nome completo do Locatário",
  "endereco": "Endereço completo do imóvel locado com pontuação e acentuação corrigidas em Português do Brasil",
  "data_inicio": "AAAA-MM-DD",
  "data_fim": "AAAA-MM-DD",
  "valor_aluguel": 0.00
}

Regras Mandatórias:
1. "proprietario": pessoa física ou jurídica identificada como LOCADOR(A). Remova CPF, estado civil e profissão.
2. "inquilino": pessoa física ou jurídica identificada como LOCATÁRIO(A). Procure por "LOCATÁRIO", "LOCATÁRIA", "INQUILINO" ou quem assinou como tal na lista de signatários Clicksign. Remova CPF e termos como "assinou como".
3. "endereco": corrija erros de codificação de caracteres comuns de PDF (exemplo: converta "PraÁa" para "Praça", "n∫" para "nº", "C‚mara" para "Câmara").
4. "data_inicio" e "data_fim": formato AAAA-MM-DD.
5. "valor_aluguel": valor numérico decimal puro (exemplo: 1000.00).

Texto do Contrato:
${text.substring(0, 25000)}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
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
    rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(rawText);

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
