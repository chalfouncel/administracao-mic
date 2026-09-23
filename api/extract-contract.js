export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Método não permitido'
    });
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  const admOpenApiKey = process.env.ADM_OPEN_API_KEY;

  if (!geminiApiKey && !admOpenApiKey) {
    return res.status(500).json({
      error: 'Configure GEMINI_API_KEY ou ADM_OPEN_API_KEY nas variáveis de ambiente da Vercel.'
    });
  }

  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({
      error: 'Texto do contrato não fornecido.'
    });
  }

  try {
    /*
     * ============================================================
     * 1. NORMALIZAÇÃO DO TEXTO
     * ============================================================
     */

    const textoOriginal = text;

    const normalizar = (valor) => {
      return String(valor || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .trim();
    };

    const texto = normalizar(textoOriginal);

    /*
     * ============================================================
     * 2. PROMPT PARA A IA
     * ============================================================
     *
     * A IA deve fazer SOMENTE a extração.
     *
     * É importante deixar claro que:
     * - LOCADOR(A) corresponde ao proprietário
     * - LOCATÁRIO(A) corresponde ao inquilino
     * - IMÓVEL corresponde ao endereço
     * - "aluguel mensal" deve ser usado para localizar o valor
     * - NÃO utilizar caução, corretagem ou taxa de assinatura
     */

    const prompt = `
Você é um sistema especializado em EXTRAÇÃO DE DADOS DE CONTRATOS DE LOCAÇÃO RESIDENCIAL.

Analise cuidadosamente o contrato abaixo e extraia SOMENTE os seguintes dados:

1. PROPRIETÁRIO
   - Localize o campo "LOCADOR(A):"
   - Retorne somente o nome da pessoa.
   - Não incluir CPF.
   - Não incluir RG.
   - Não incluir estado civil.
   - Não incluir profissão.
   - Não incluir endereço residencial.
   - Não incluir e-mail.
   - Não incluir telefone.
   - Não confundir com beneficiário de PIX ou outra pessoa mencionada posteriormente.

2. INQUILINO
   - Localize o campo "LOCATÁRIO(A):"
   - Retorne somente o nome da pessoa.
   - Não incluir CPF.
   - Não incluir RG.
   - Não incluir estado civil.
   - Não incluir profissão.
   - Não incluir endereço residencial.
   - Não incluir e-mail.
   - Não incluir telefone.

3. ENDEREÇO
   - Localize o campo "IMÓVEL:"
   - Retorne a descrição/endereço do imóvel locado.
   - Não retornar o endereço residencial do proprietário.
   - Não retornar o endereço residencial do inquilino.
   - Preserve número, bloco, apartamento, bairro, cidade, estado e CEP quando existirem.

4. DATA DE INÍCIO
   - Localize a data que representa o início da vigência da locação.
   - Normalmente aparece em uma frase como:
     "com início em DD/MM/AAAA"
   - Retorne obrigatoriamente no formato:
     AAAA-MM-DD

5. DATA DE FIM
   - Localize a data final da vigência do contrato.
   - Pode aparecer como:
     "Data Final do Contrato em DD/MM/AAAA"
     ou expressão equivalente.
   - Retorne obrigatoriamente no formato:
     AAAA-MM-DD

6. VALOR DO ALUGUEL
   - Localize especificamente o valor associado ao ALUGUEL MENSAL.
   - Procure expressões como:
     "O aluguel mensal"
     "valor do aluguel"
     "aluguel mensal ... R$"
   - NÃO confundir com:
     caução;
     garantia locatícia;
     honorários de corretagem;
     taxa de assinatura;
     condomínio;
     IPTU;
     multas;
     outros valores.
   - Retorne somente o valor numérico.
   - Exemplo:
     R$ 1.000,00 -> 1000.00

REGRAS IMPORTANTES:

- O documento está em português do Brasil.
- Preserve corretamente os nomes próprios.
- Não invente informações.
- Não faça cálculos.
- Não utilize informações de outros contratos.
- Se uma informação não estiver disponível, retorne string vazia.
- O valor do aluguel deve ser numérico.
- As datas devem estar no formato AAAA-MM-DD.

RETORNE EXATAMENTE ESTE JSON:

{
  "proprietario": "",
  "inquilino": "",
  "endereco": "",
  "data_inicio": "",
  "data_fim": "",
  "valor_aluguel": 0
}

NÃO escreva explicações.
NÃO escreva Markdown.
NÃO coloque o JSON dentro de \`\`\`.
RETORNE SOMENTE O OBJETO JSON.

CONTRATO:

${texto}
`;

    /*
     * ============================================================
     * 3. CHAMADA À IA (Gemini principal → OpenRouter fallback)
     * ============================================================
     */

    let rawText = '';
    const erros = [];

    // --------- PROVEDOR 1: GEMINI (schema estruturado garante JSON) ---------
    if (geminiApiKey) {
      try {
        const url =
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' +
          encodeURIComponent(geminiApiKey);

        const response = await fetch(url, {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json'
          },

          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: prompt
                  }
                ]
              }
            ],

            generationConfig: {
              temperature: 0,

              responseMimeType: 'application/json',

              responseSchema: {
                type: 'OBJECT',

                properties: {
                  proprietario: {
                    type: 'STRING'
                  },

                  inquilino: {
                    type: 'STRING'
                  },

                  endereco: {
                    type: 'STRING'
                  },

                  data_inicio: {
                    type: 'STRING'
                  },

                  data_fim: {
                    type: 'STRING'
                  },

                  valor_aluguel: {
                    type: 'NUMBER'
                  }
                },

                required: [
                  'proprietario',
                  'inquilino',
                  'endereco',
                  'data_inicio',
                  'data_fim',
                  'valor_aluguel'
                ]
              }
            }
          })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error?.message || 'Erro ao consultar a API do Gemini.');
        }

        rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!rawText) {
          throw new Error('O Gemini não retornou dados para o contrato.');
        }
      } catch (err) {
        erros.push('Gemini: ' + err.message);
        rawText = '';
      }
    }

    // --------- PROVEDOR 2: OPENROUTER (fallback — GPT-4o-mini) ---------
    if (!rawText && admOpenApiKey) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${admOpenApiKey}`,
            'HTTP-Referer': 'https://adm.miccorretores.com.br',
            'X-Title': 'M&IC Extract Contract'
          },
          body: JSON.stringify({
            model: 'openai/gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'Você é um sistema de extração de dados de contratos de locação. Responda APENAS com JSON válido, sem explicações, sem markdown, sem blocos de código.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0,
            max_tokens: 1024,
            response_format: { type: 'json_object' }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenRouter HTTP ${response.status}: ${errText}`);
        }

        const data = await response.json();
        rawText = data?.choices?.[0]?.message?.content || '';

        if (!rawText) {
          throw new Error('O OpenRouter não retornou dados para o contrato.');
        }
      } catch (err) {
        erros.push('OpenRouter: ' + err.message);
        rawText = '';
      }
    }

    if (!rawText) {
      return res.status(500).json({
        error: 'Nenhum provedor de IA respondeu para o contrato.',
        details: erros
      });
    }

    /*
     * ============================================================
     * 4. LIMPEZA DA RESPOSTA
     * ============================================================
     */

    rawText = rawText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    let resultadoIA;

    try {
      resultadoIA = JSON.parse(rawText);
    } catch (parseError) {
      console.error('Resposta inválida da IA:', rawText);

      return res.status(500).json({
        error: 'A IA retornou um JSON inválido.',
        raw: rawText
      });
    }

    /*
     * ============================================================
     * 5. FUNÇÕES DE NORMALIZAÇÃO
     * ============================================================
     */

    const limparNome = (valor) => {
      return String(valor || '')
        .replace(/^LOCADOR\s*\(?\s*A?\s*\)?\s*:\s*/i, '')
        .replace(/^LOCAT[ÁA]RIO\s*\(?\s*A?\s*\)?\s*:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const limparEndereco = (valor) => {
      return String(valor || '')
        .replace(/^IM[ÓO]VEL\s*:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const normalizarData = (valor) => {
      const data = String(valor || '').trim();

      if (!data) {
        return '';
      }

      /*
       * Caso retorne DD/MM/AAAA
       */
      let match = data.match(
        /^(\d{2})\/(\d{2})\/(\d{4})$/
      );

      if (match) {
        return `${match[3]}-${match[2]}-${match[1]}`;
      }

      /*
       * Caso retorne DD-MM-AAAA
       */
      match = data.match(
        /^(\d{2})-(\d{2})-(\d{4})$/
      );

      if (match) {
        return `${match[3]}-${match[2]}-${match[1]}`;
      }

      /*
       * Caso já esteja em AAAA-MM-DD
       */
      match = data.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

      if (match) {
        return data;
      }

      return '';
    };

    const normalizarValor = (valor) => {
      if (
        valor === null ||
        valor === undefined ||
        valor === ''
      ) {
        return 0;
      }

      if (typeof valor === 'number') {
        return Number(valor.toFixed(2));
      }

      let textoValor = String(valor)
        .replace(/[R$\s]/g, '')
        .trim();

      /*
       * Formato brasileiro:
       * 1.000,00
       */
      if (
        textoValor.includes('.') &&
        textoValor.includes(',')
      ) {
        textoValor = textoValor
          .replace(/\./g, '')
          .replace(',', '.');
      }

      /*
       * Formato:
       * 1000,00
       */
      else if (textoValor.includes(',')) {
        textoValor = textoValor.replace(',', '.');
      }

      const numero = Number(textoValor);

      return Number.isFinite(numero)
        ? Number(numero.toFixed(2))
        : 0;
    };

    /*
     * ============================================================
     * 6. RESULTADO NORMALIZADO
     * ============================================================
     */

    const resultado = {
      proprietario: limparNome(
        resultadoIA?.proprietario
      ),

      inquilino: limparNome(
        resultadoIA?.inquilino
      ),

      endereco: limparEndereco(
        resultadoIA?.endereco
      ),

      data_inicio: normalizarData(
        resultadoIA?.data_inicio
      ),

      data_fim: normalizarData(
        resultadoIA?.data_fim
      ),

      valor_aluguel: normalizarValor(
        resultadoIA?.valor_aluguel
      )
    };

    /*
     * ============================================================
     * 7. RETORNO
     * ============================================================
     */

    return res.status(200).json(resultado);

  } catch (error) {
    console.error(
      'Erro na extração do contrato:',
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        'Erro interno ao processar o contrato.'
    });
  }
}
