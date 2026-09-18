export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada na Vercel.' });
  }

  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Mensagem vazia.' });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Você é o assistente virtual de locação da M&IC Corretores de Imóveis. Responda de forma profissional e objetiva: ${message}`
          }]
        }]
      })
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sem resposta do modelo.';
    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
