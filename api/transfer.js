export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Método não permitido" });

    const { idReg, mesRef } = req.body;
    const SUPABASE_URL = 'https://dgadztmmarvbjcouvrnp.supabase.co';
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const ASAAS_KEY = process.env.ASAAS_API_KEY;

    try {
        const resGet = await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${idReg}`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        const dataGet = await resGet.json();
        if (!dataGet || dataGet.length === 0) return res.status(400).json({ error: 'Contrato não encontrado' });
        const c = dataGet[0];

        function pM(str) {
            if (!str || String(str).toLowerCase() === 'não' || String(str).toLowerCase() === 'nao') return 0;
            if (typeof str === 'number') return str;
            return parseFloat(String(str).replace(/[^\d,-]/g, '').replace(',', '.')) || 0;
        }
        
        let lanc = {}; try { lanc = JSON.parse(c.lancamentos_mensais || '{}'); } catch(e){}
        let lMes = lanc[mesRef] || {};
        
        let vAlugPropStr = lMes.aluguel_prop !== undefined ? lMes.aluguel_prop : ""; 
        let isPropActive = vAlugPropStr && String(vAlugPropStr).toLowerCase() !== 'não' && String(vAlugPropStr).toLowerCase() !== 'nao';
        
        let vAlugProp = pM(vAlugPropStr);
        let vCondProp = pM(lMes.cond_prop);
        let vAlugMes = lMes.aluguel_mes !== undefined ? pM(lMes.aluguel_mes) : (isPropActive ? 0 : pM(c.aluguel_base));
        let vCondMes = lMes.cond_mes !== undefined ? pM(lMes.cond_mes) : pM(c.condominio_base);
        let vIptu = pM(lMes.iptu);
        let vBombeiro = pM(lMes.bombeiro);
        let vSeguro = pM(lMes.seguro);
        let vOutras = pM(lMes.outras_taxas);
        let vDesconto = pM(lMes.desconto);
        let vTaxaAdm = pM(c.taxa_adm_fixa);
        
        let repassaCond = c.regra_condominio !== 'N'; 
        let repassaSeguro = c.regra_seguro !== 'N';

        let valCondominioPix = repassaCond ? 0 : (vCondProp + vCondMes);
        let valSeguroMIC = repassaSeguro ? 0 : vSeguro;
        
        let totalReceitas = vAlugProp + vAlugMes + vCondProp + vCondMes + vIptu + vBombeiro + vSeguro + vOutras - vDesconto;
        
        let valProprietario = totalReceitas - vTaxaAdm - valCondominioPix - valSeguroMIC;
        let valMIC = vTaxaAdm + valSeguroMIC;

        async function sendPix(value, rawKey, desc) {
            if (value <= 0 || !rawKey) return { success: true };
            
            let cleanKey = rawKey.trim();
            let keyType = 'EVP';
            let finalKey = cleanKey;

            // Motor Matemático de Validação de CPF
            const isCpf = (cpf) => {
                cpf = cpf.replace(/\D/g, '');
                if(cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
                let sum = 0, rest;
                for (let i = 1; i <= 9; i++) sum = sum + parseInt(cpf.substring(i-1, i)) * (11 - i);
                rest = (sum * 10) % 11;
                if ((rest === 10) || (rest === 11)) rest = 0;
                if (rest !== parseInt(cpf.substring(9, 10))) return false;
                sum = 0;
                for (let i = 1; i <= 10; i++) sum = sum + parseInt(cpf.substring(i-1, i)) * (12 - i);
                rest = (sum * 10) % 11;
                if ((rest === 10) || (rest === 11)) rest = 0;
                return rest === parseInt(cpf.substring(10, 11));
            };

            // Inteligência de Chaves PIX
            if (cleanKey.includes('@')) {
                keyType = 'EMAIL';
            } else if (cleanKey.match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)) {
                keyType = 'EVP'; // Chave Aleatória UUID
            } else {
                let digits = cleanKey.replace(/\D/g, '');
                if (digits.length === 14) {
                    keyType = 'CNPJ';
                    finalKey = digits;
                } else if (digits.length === 11) {
                    // O Grande Conflito de 11 dígitos resolvido
                    if (isCpf(digits)) {
                        keyType = 'CPF';
                        finalKey = digits;
                    } else {
                        keyType = 'PHONE';
                        // Injeta o +55 obrigatoriamente se for telefone
                        finalKey = digits.startsWith('55') ? '+' + digits : '+55' + digits;
                    }
                } else if (digits.length >= 10 && digits.length <= 13) {
                    keyType = 'PHONE';
                    finalKey = digits.startsWith('55') ? '+' + digits : '+55' + digits;
                }
            }
            
            const transferRes = await fetch('https://api.asaas.com/v3/transfers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'access_token': ASAAS_KEY },
                body: JSON.stringify({ 
                    value: parseFloat(value.toFixed(2)), 
                    operationType: "PIX", 
                    pixAddressKey: finalKey, 
                    pixAddressKeyType: keyType, 
                    description: desc 
                })
            });
            
            const transferData = await transferRes.json();
            
            if (transferData.errors) return { success: false, error: transferData.errors[0].description };
            if (!transferData.id) return { success: false, error: "Falha desconhecida no banco Asaas." };
            return { success: true };
        }

        let errors = [];
        
        let resProp = await sendPix(valProprietario, c.pix_proprietario, `Repasse M&IC - ${c.inquilino}`);
        if(!resProp.success) errors.push(`Proprietário: ${resProp.error}`);
        
        let resMIC = await sendPix(valMIC, 'chalfouncorretor@gmail.com', `Taxa Adm + Seguro - ${c.inquilino}`);
        if(!resMIC.success) errors.push(`M&IC: ${resMIC.error}`);
        
        let resCond = await sendPix(valCondominioPix, c.pix_condominio, `Condomínio M&IC - ${c.endereco}`);
        if(!resCond.success) errors.push(`Condomínio: ${resCond.error}`);

        if (errors.length > 0) return res.status(400).json({ error: errors.join(" | ") });

        let statusRepasse = {}; try { statusRepasse = JSON.parse(c.status_repasse || '{}'); } catch(e){}
        statusRepasse[mesRef] = 'recebida';
        await fetch(`${SUPABASE_URL}/rest/v1/locacoes?id=eq.${idReg}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
            body: JSON.stringify({ status_repasse: JSON.stringify(statusRepasse) })
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
