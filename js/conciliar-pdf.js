/**
 * CONCILIAR (CSV e PDF)
 * Compara a fatura do cartão ou o extrato da conta com os lançamentos já
 * registrados no app, e aponta o que está num lado e não no outro. Só
 * relatório — não grava nada no banco.
 * Duas instâncias independentes, uma por aba de Importar (cada uma só
 * entende o próprio formato de arquivo, nunca mistura CSV com PDF):
 *  - Aba PDF: fatura Bradesco (2 layouts — export do app "Bradesco
 *    Cartões" e a fatura/boleto "Fatura Mensal") e extrato Mercado Pago.
 *  - Aba CSV: fatura Nubank e extrato Mercado Pago.
 */

// Duas instâncias independentes, uma por aba (CSV só lê .csv, PDF só lê
// .pdf) — nunca menciona um formato que não seja o da própria aba.
const _estadosConciliar = {}; // secId -> { pdfs: [...] }

/** formatoRestrito: null (aceita qualquer formato da aba) | 'bradesco' | 'nubank' | 'mp'
 *  — o dropdown de formato em Importar sempre manda um valor específico;
 *  null só existe pra chamadas antigas/testes. */
function _iniciarConciliar(secId, modo, formatoRestrito = null) {
    const sec = document.getElementById(secId);
    if (!sec) return;
    _estadosConciliar[secId] = { pdfs: [], formatoRestrito };
    if (modo === 'pdf' && typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    renderConciliar(secId, modo);
}

/* ---------- Extração de texto (pdf.js) ---------- */

async function _extrairTextoPDF(arrayBuffer) {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const paginas = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        paginas.push(tc.items.map(it => it.str).join(' '));
    }
    return paginas.join('\n');
}

/* ---------- Normalização / matching de nome próprio (self-transfer) ---------- */

function _normalizarTexto(s) {
    return String(s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

/* ---------- Parser: fatura Bradesco Cartões ---------- */

function _pareceFaturaBradesco(texto) {
    return /Aplicativo Bradesco Cart[oõ]es/i.test(texto);
}

function _parsearFaturaBradesco(texto) {
    const mData = texto.match(/Data:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const reportMes = mData ? parseInt(mData[2], 10) : (new Date().getMonth() + 1);
    const reportAno = mData ? parseInt(mData[3], 10) : new Date().getFullYear();
    const anoDe = mes => (mes <= reportMes ? reportAno : reportAno - 1);

    const re = /(\d{2})\/(\d{2})\s+(.+?)\s+(BRL|USD)\s+(-?[\d.,]+)\s+[\d.,]+\s+R\$\s*[\d.,]+\s+(-?[\d.,]+)/g;
    const linhas = [];
    let m;
    while ((m = re.exec(texto))) {
        const [, dia, mes, descricaoRaw, , , valorFinalRaw] = m;
        const descricao = descricaoRaw.trim();
        const dNorm = _normalizarTexto(descricao);
        if (dNorm === 'saldo anterior') continue;          // não é lançamento
        if (/^total (para|da fatura)/.test(dNorm)) continue;

        const valor = _parsearValorBR(valorFinalRaw);
        if (valor == null) continue;

        linhas.push({
            dataISO: `${anoDe(parseInt(mes, 10))}-${mes}-${dia}`,
            descricao,
            valorBruto: valor,
            tipo: valor < 0 ? 'entradas' : 'saidas',
            valor: Math.abs(valor),
            ignorarDefault: dNorm === 'pag boleto bancario'
        });
    }
    return linhas;
}

/* ---------- Parser: fatura Bradesco (layout "boleto"/Fatura Mensal) ---------- */
/* Segundo formato de fatura do Bradesco — o PDF que vem junto do boleto,
 * bem diferente do export do app (sem BRL/USD explícito por linha, e com
 * uma coluna de Cidade solta entre a descrição e o valor). */

function _pareceFaturaBradescoBoleto(texto) {
    return /Fatura Mensal/i.test(texto) && /Lan[cç]amentos/i.test(texto) && /bradesco/i.test(texto);
}

function _parsearFaturaBradescoBoleto(texto) {
    const mVenc = texto.match(/Data de Vencimento\s*(\d{2})\/(\d{2})\/(\d{4})/) || texto.match(/Vencimento\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const refMes = mVenc ? parseInt(mVenc[2], 10) : (new Date().getMonth() + 1);
    const refAno = mVenc ? parseInt(mVenc[3], 10) : new Date().getFullYear();
    const anoDe = mes => (mes <= refMes ? refAno : refAno - 1);

    // Restringe à seção "Lançamentos" (antes do "Total para..."), pra não
    // pegar números soltos do resto do boleto (limites, taxas, juros...).
    const inicio = texto.search(/Lan[cç]amentos/i);
    if (inicio < 0) return [];
    const aposInicio = texto.slice(inicio);
    const fimRel = aposInicio.search(/Total (para|da fatura)/i);
    const trecho = fimRel >= 0 ? aposInicio.slice(0, fimRel) : aposInicio;

    // Descrição não-gulosa até o primeiro valor "1.234,56" — não tenta achar
    // a próxima data como limite, então uma linha com US$ (2 valores antes
    // do R$) só pega o 1º valor certo se não houver conversão de moeda.
    const re = /(\d{2})\/(\d{2})\s+(.+?)\s+([\d.]+,\d{2})\s*(-)?/g;
    const linhas = [];
    let m;
    while ((m = re.exec(trecho))) {
        const [, dia, mes, descricaoRaw, valorRaw, sinal] = m;
        const descricao = descricaoRaw.trim();
        const dNorm = _normalizarTexto(descricao);
        if (/^cart[aã]o \d/.test(dNorm)) continue; // sub-cabeçalho "Cartão 4066 XXXX..." de um 2º cartão na mesma fatura

        let valor = _parsearValorBR(valorRaw);
        if (valor == null) continue;
        if (sinal === '-') valor = -Math.abs(valor);

        linhas.push({
            dataISO: `${anoDe(parseInt(mes, 10))}-${mes}-${dia}`,
            descricao,
            valorBruto: valor,
            tipo: valor < 0 ? 'entradas' : 'saidas',
            valor: Math.abs(valor),
            ignorarDefault: dNorm === 'pag boleto bancario'
        });
    }
    return linhas;
}

/* ---------- Parser: fatura Nubank (CSV) ---------- */

function _pareceFaturaNubankCSV(texto) {
    const primeiraLinha = (texto.split(/\r?\n/)[0] || '').trim();
    return /^date,title,amount/i.test(primeiraLinha);
}

function _parsearFaturaNubankCSV(texto) {
    // Mesmo parser de CSV com aspas do Importar CSV (js/importar-csv.js) —
    // aqui tem descrição com aspas duplicadas dentro ("Estorno de ""X""").
    const linhasCSV = _parsearCSV(texto);
    if (!linhasCSV.length) return [];
    let inicio = 0;
    if (linhasCSV[0] && /^date$/i.test(String(linhasCSV[0][0] || '').trim())) inicio = 1;

    const linhas = [];
    for (let i = inicio; i < linhasCSV.length; i++) {
        const [dataCru, tituloCru, valorCru] = linhasCSV[i];
        const mData = String(dataCru || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!mData) continue;

        const descricao = String(tituloCru || '').trim();
        const dNorm = _normalizarTexto(descricao);
        const valor = _parsearValorBR(valorCru);
        if (valor == null) continue;

        linhas.push({
            dataISO: `${mData[1]}-${mData[2]}-${mData[3]}`,
            descricao,
            valorBruto: valor,
            // Nubank: valor positivo = compra, negativo = estorno/pagamento
            // recebido/desconto — mesma convenção de sinal dos outros formatos.
            tipo: valor < 0 ? 'entradas' : 'saidas',
            valor: Math.abs(valor),
            // "Pagamento recebido" é a própria fatura sendo paga pela conta
            // vinculada (movimento interno) — o resto (estornos, descontos)
            // é ajuste real de compra, não some da comparação por padrão.
            ignorarDefault: dNorm.startsWith('pagamento recebido')
        });
    }
    return linhas;
}

/* ---------- Parser: extrato Mercado Pago ---------- */

function _pareceExtratoMercadoPago(texto) {
    return /EXTRATO DE CONTA/i.test(texto) && /mercado\s*pago/i.test(texto);
}

function _parsearExtratoMercadoPago(texto) {
    // O cabeçalho ("Periodo: De DD-MM-YYYY al DD-MM-YYYY", CPF, Conta) tem
    // datas e números de 10+ dígitos soltos que colidem com o padrão de
    // linha — corta tudo antes da tabela de verdade pra não pegar isso.
    const inicioTabela = texto.search(/DETALHE DOS MOVIMENTOS/i);
    if (inicioTabela >= 0) texto = texto.slice(inicioTabela);

    const re = /(\d{2})-(\d{2})-(\d{4})\s+(.+?)\s+(\d{10,})\s+R\$\s*(-?[\d.,]+)\s+R\$\s*[\d.,]+/g;
    const linhas = [];
    let m;
    while ((m = re.exec(texto))) {
        const [, dia, mes, ano, descricaoRaw, , valorRaw] = m;
        const descricao = descricaoRaw.trim();
        const dNorm = _normalizarTexto(descricao);
        const valor = _parsearValorBR(valorRaw);
        if (valor == null) continue;

        linhas.push({
            dataISO: `${ano}-${mes}-${dia}`,
            descricao,
            valorBruto: valor,
            tipo: valor < 0 ? 'saidas' : 'entradas',
            valor: Math.abs(valor),
            ignorarDefault: _ehLinhaInternaMercadoPago(dNorm)
        });
    }
    return linhas;
}

/** Linhas que não são gasto/receita real (movimentação interna do usuário
 *  consigo mesmo) — usado tanto no extrato em PDF quanto no CSV. */
function _ehLinhaInternaMercadoPago(dNorm) {
    const ehRendimento = dNorm.startsWith('rendimentos');
    const ehPouquinho = dNorm.startsWith('dinheiro reservado') || dNorm.startsWith('dinheiro retirado');
    const ehCDB = dNorm.startsWith('liberacao cdb') || dNorm.startsWith('liberacao de cdb');
    const ehPixParaSiMesmo = /^pix (enviado|recebido) rafael loureiro braz$/.test(dNorm);
    const ehPagamentoFatura = dNorm.startsWith('pagamento de fatura');
    return ehRendimento || ehPouquinho || ehCDB || ehPixParaSiMesmo || ehPagamentoFatura;
}

/* ---------- Parser: extrato Mercado Pago (CSV) ---------- */

function _pareceExtratoMercadoPagoCSV(texto) {
    return /RELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID/i.test(texto);
}

function _parsearExtratoMercadoPagoCSV(texto) {
    // Delimitador ';' (não ',' como o resto do app) e sem aspas nos campos
    // nesse export — um split simples por linha já basta.
    const linhas = texto.replace(/\r\n/g, '\n').split('\n').map(l => l.split(';'));
    const cabecalhoIdx = linhas.findIndex(l => l[0] && l[0].trim() === 'RELEASE_DATE');
    if (cabecalhoIdx < 0) return [];

    const resultado = [];
    for (let i = cabecalhoIdx + 1; i < linhas.length; i++) {
        const [dataCru, tipoCru, , valorCru] = linhas[i];
        const mData = String(dataCru || '').trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (!mData) continue;

        const descricao = String(tipoCru || '').trim();
        const dNorm = _normalizarTexto(descricao);
        const valor = _parsearValorBR(valorCru);
        if (valor == null) continue;

        resultado.push({
            dataISO: `${mData[3]}-${mData[2]}-${mData[1]}`,
            descricao,
            valorBruto: valor,
            tipo: valor < 0 ? 'saidas' : 'entradas',
            valor: Math.abs(valor),
            ignorarDefault: _ehLinhaInternaMercadoPago(dNorm)
        });
    }
    return resultado;
}

/* ---------- Comparação com o app ---------- */

/** Busca transações do período — despesas restritas ao método escolhido
 *  (o extrato/fatura só cobre esse método), receitas sem restrição de
 *  método (o formulário de receita não tem campo de método). */
async function _buscarTransacoesParaConciliar(metodoDespesa, dataIni, dataFim) {
    const { data, error } = await sb
        .from('transacoes')
        .select('*')
        .gte('data', dataIni)
        .lte('data', dataFim);
    if (error) { console.error('Erro ao buscar transações pra conciliar:', error); return []; }
    return (data || []).filter(t => t.tipo === 'entradas' || t.metodo === metodoDespesa);
}

function _diffDias(iso1, iso2) {
    const a = new Date(iso1 + 'T00:00:00'), b = new Date(iso2 + 'T00:00:00');
    return Math.abs((a - b) / 86400000);
}

/** Casa cada linha do PDF (não ignorada) com uma transação do app (mesmo
 *  tipo, mesmo valor, data próxima) — cada transação só é usada uma vez. */
function _conciliar(linhasPDF, transacoesApp) {
    const pool = transacoesApp.map(t => ({ t, usada: false }));
    const semMatch = [];

    linhasPDF.forEach(l => {
        if (l.ignorar) return;
        const candidata = pool.find(p =>
            !p.usada && p.t.tipo === l.tipo &&
            Math.abs(Math.abs(parseFloat(p.t.valor)) - l.valor) < 0.005 &&
            _diffDias(p.t.data, l.dataISO) <= 2
        );
        if (candidata) candidata.usada = true;
        else semMatch.push(l);
    });

    const naoLancadas = pool.filter(p => !p.usada).map(p => p.t);
    return { noPdfNaoNoApp: semMatch, noAppNaoNoPdf: naoLancadas };
}

/* ---------- Fluxo por arquivo ---------- */

async function onConciliarArquivos(e, secId, modo) {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    const estado = _estadosConciliar[secId];

    for (const file of files) {
        const entrada = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            nomeArquivo: file.name,
            status: 'carregando',
            erro: null,
            formato: null,
            linhas: [],
            metodoEscolhido: '',
            resultado: null
        };
        estado.pdfs.push(entrada);
        renderConciliar(secId, modo);

        try {
            const texto = modo === 'csv' ? await file.text() : await _extrairTextoPDF(await file.arrayBuffer());
            const credito = () => {
                const m = (estadoApp.menus.metodos || []).find(m => m.metodoKind === 'Crédito');
                return m ? rotuloMetodo(m) : '';
            };
            const pixOuDebito = () => {
                const m = (estadoApp.menus.metodos || []).find(m => _normalizarTexto(rotuloMetodo(m)).includes('pix'));
                return m ? rotuloMetodo(m) : '';
            };
            const fr = estado.formatoRestrito; // 'bradesco' | 'nubank' | 'mp' | null (aceita qualquer um da aba)
            const podeBradesco = modo === 'pdf' && (!fr || fr === 'bradesco');
            const podeNubank = modo === 'csv' && (!fr || fr === 'nubank');
            const podeMP = !fr || fr === 'mp';

            if (podeBradesco && _pareceFaturaBradesco(texto)) {
                entrada.formato = 'fatura';
                entrada.linhas = _parsearFaturaBradesco(texto).map(l => ({ ...l, ignorar: l.ignorarDefault }));
                entrada.metodoEscolhido = credito();
            } else if (podeBradesco && _pareceFaturaBradescoBoleto(texto)) {
                entrada.formato = 'fatura';
                entrada.linhas = _parsearFaturaBradescoBoleto(texto).map(l => ({ ...l, ignorar: l.ignorarDefault }));
                entrada.metodoEscolhido = credito();
            } else if (modo === 'pdf' && podeMP && _pareceExtratoMercadoPago(texto)) {
                entrada.formato = 'extrato';
                entrada.linhas = _parsearExtratoMercadoPago(texto).map(l => ({ ...l, ignorar: l.ignorarDefault }));
                entrada.metodoEscolhido = pixOuDebito();
            } else if (modo === 'csv' && podeMP && _pareceExtratoMercadoPagoCSV(texto)) {
                entrada.formato = 'extrato';
                entrada.linhas = _parsearExtratoMercadoPagoCSV(texto).map(l => ({ ...l, ignorar: l.ignorarDefault }));
                entrada.metodoEscolhido = pixOuDebito();
            } else if (podeNubank && _pareceFaturaNubankCSV(texto)) {
                entrada.formato = 'fatura';
                entrada.linhas = _parsearFaturaNubankCSV(texto).map(l => ({ ...l, ignorar: l.ignorarDefault }));
                entrada.metodoEscolhido = credito();
            } else {
                throw new Error(`Esse arquivo não parece ${_rotuloFormatoRestrito(fr, modo)}.`);
            }

            if (!entrada.linhas.length) throw new Error('Não encontrei nenhum lançamento nesse arquivo.');

            entrada.status = 'pronto';
            await _recompararPDV(entrada);
        } catch (err) {
            console.error('Erro ao processar arquivo:', err);
            entrada.status = 'erro';
            entrada.erro = err.message || 'Erro ao ler o arquivo';
        }
        renderConciliar(secId, modo);
    }
}

async function _recompararPDV(entrada) {
    const datas = entrada.linhas.map(l => l.dataISO).sort();
    const dataIni = datas[0], dataFim = datas[datas.length - 1];
    const transacoes = await _buscarTransacoesParaConciliar(entrada.metodoEscolhido, dataIni, dataFim);
    entrada.resultado = _conciliar(entrada.linhas, transacoes);
}

/* ---------- Render ---------- */

/** Nome legível do formato pra que o dropdown de Importar restringiu essa
 *  instância — usado no texto de ajuda e na mensagem de erro. */
function _rotuloFormatoRestrito(formatoRestrito, modo) {
    if (formatoRestrito === 'bradesco') return 'uma fatura Crédito Bradesco';
    if (formatoRestrito === 'nubank') return 'uma fatura Crédito Nubank';
    if (formatoRestrito === 'mp') return `um extrato Mercado Pago (${modo === 'pdf' ? 'PDF' : 'CSV'})`;
    return modo === 'pdf' ? 'fatura Crédito Bradesco ou extrato Mercado Pago' : 'fatura Crédito Nubank ou extrato Mercado Pago';
}

function renderConciliar(secId, modo) {
    const sec = document.getElementById(secId);
    const estado = _estadosConciliar[secId];
    if (!sec || !estado) return;

    const listaId = `${secId}Lista`;
    const arquivoId = `${secId}Arquivo`;
    const dica = `Sobe ${_rotuloFormatoRestrito(estado.formatoRestrito, modo)} — compara com o que já está lançado
        no app e só aponta as diferenças, não grava nada automaticamente.`;
    const accept = modo === 'pdf' ? '.pdf,application/pdf' : '.csv,text/csv';

    sec.innerHTML = `
    <p class="menu-hint">${dica}</p>
    <div class="import-csv-upload">
        <input type="file" id="${arquivoId}" accept="${accept}" multiple>
    </div>
    <div id="${listaId}"></div>
    `;
    document.getElementById(arquivoId)?.addEventListener('change', e => onConciliarArquivos(e, secId, modo));

    const lista = document.getElementById(listaId);
    lista.innerHTML = estado.pdfs.map(p => _renderPdfEntrada(p, modo)).join('');

    estado.pdfs.forEach(p => {
        document.getElementById(`conciliarMetodo-${p.id}`)?.addEventListener('change', async e => {
            p.metodoEscolhido = e.target.value;
            await _recompararPDV(p);
            renderConciliar(secId, modo);
        });
        (p.linhas || []).forEach((l, i) => {
            document.getElementById(`conciliarIgnorar-${p.id}-${i}`)?.addEventListener('change', e => {
                l.ignorar = e.target.checked;
                _recompararPDV(p).then(() => renderConciliar(secId, modo));
            });
        });
    });
}

function _renderPdfEntrada(p, modo) {
    const rotuloArquivo = modo === 'pdf' ? 'PDF' : 'CSV';
    if (p.status === 'carregando') {
        return `<div class="conciliar-pdf-card"><b>${p.nomeArquivo}</b> — lendo...</div>`;
    }
    if (p.status === 'erro') {
        return `<div class="conciliar-pdf-card conciliar-pdf-card--erro"><b>${p.nomeArquivo}</b> — ${p.erro}</div>`;
    }

    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const rotuloFormato = p.formato === 'fatura' ? 'Fatura de cartão' : 'Extrato de conta';
    const res = p.resultado || { noPdfNaoNoApp: [], noAppNaoNoPdf: [] };
    const totalIgnoradas = p.linhas.filter(l => l.ignorar).length;
    const bateram = p.linhas.length - totalIgnoradas - res.noPdfNaoNoApp.length;

    return `
    <div class="conciliar-pdf-card">
        <div class="conciliar-pdf-topo">
            <b>${p.nomeArquivo}</b>
            <span class="import-csv-label-linha">${rotuloFormato}</span>
            <label class="conciliar-pdf-metodo">Método correspondente
                <select id="conciliarMetodo-${p.id}">
                    <option value="">Selecione...</option>
                    ${metodos.map(m => {
                        const r = rotuloMetodo(m);
                        return `<option value="${r}" ${p.metodoEscolhido === r ? 'selected' : ''}>${r}</option>`;
                    }).join('')}
                </select>
            </label>
        </div>
        <p class="import-csv-resumo">
            ${p.linhas.length} linhas no ${rotuloArquivo} (${totalIgnoradas} ignoradas) —
            <span class="ok">${bateram} bateram</span> ·
            <span class="alerta">${res.noPdfNaoNoApp.length} no ${rotuloArquivo} mas não no app</span> ·
            <span class="alerta">${res.noAppNaoNoPdf.length} no app mas não no ${rotuloArquivo}</span>
        </p>

        <div class="import-csv-grupo-titulo">⚠️ No ${rotuloArquivo} mas não lançado no app (${res.noPdfNaoNoApp.length})</div>
        ${_renderTabelaLinhasPDF(p, res.noPdfNaoNoApp)}

        <div class="import-csv-grupo-titulo">⚠️ Lançado no app mas não no ${rotuloArquivo} (${res.noAppNaoNoPdf.length})</div>
        ${_renderTabelaTransacoesApp(res.noAppNaoNoPdf)}

        <div class="import-csv-grupo-titulo">Todas as linhas do ${rotuloArquivo} (marque pra ignorar da comparação)</div>
        ${_renderTabelaTodasLinhas(p)}
    </div>`;
}

function _renderTabelaLinhasPDF(p, linhas) {
    if (!linhas.length) return `<p class="import-csv-desc">Nenhuma.</p>`;
    return `
    <div class="import-csv-tabela-wrap">
        <table class="import-csv-tabela">
            <thead><tr><th>Data</th><th>Valor</th><th>Tipo</th><th>Descrição</th></tr></thead>
            <tbody>${linhas.map(l => `
                <tr>
                    <td>${l.dataISO.split('-').reverse().join('/')}</td>
                    <td>${formatarMoeda(l.valor)}</td>
                    <td><span class="chip-tipo chip-tipo--${l.tipo}">${l.tipo === 'entradas' ? 'Receita' : 'Despesa'}</span></td>
                    <td class="import-csv-desc" title="${l.descricao}">${l.descricao}</td>
                </tr>`).join('')}</tbody>
        </table>
    </div>`;
}

function _renderTabelaTransacoesApp(transacoes) {
    if (!transacoes.length) return `<p class="import-csv-desc">Nenhuma.</p>`;
    return `
    <div class="import-csv-tabela-wrap">
        <table class="import-csv-tabela">
            <thead><tr><th>Data</th><th>Valor</th><th>Tipo</th><th>Categoria</th><th>Descrição</th></tr></thead>
            <tbody>${transacoes.map(t => `
                <tr>
                    <td>${String(t.data).slice(0, 10).split('-').reverse().join('/')}</td>
                    <td>${formatarMoeda(Math.abs(parseFloat(t.valor)))}</td>
                    <td><span class="chip-tipo chip-tipo--${t.tipo}">${t.tipo === 'entradas' ? 'Receita' : 'Despesa'}</span></td>
                    <td>${t.categoria || ''}</td>
                    <td class="import-csv-desc" title="${t.descricao || ''}">${t.descricao || ''}</td>
                </tr>`).join('')}</tbody>
        </table>
    </div>`;
}

function _renderTabelaTodasLinhas(p) {
    if (!p.linhas.length) return '';
    return `
    <div class="import-csv-tabela-wrap">
        <table class="import-csv-tabela">
            <thead><tr><th>Ignorar</th><th>Data</th><th>Valor</th><th>Tipo</th><th>Descrição</th></tr></thead>
            <tbody>${p.linhas.map((l, i) => `
                <tr>
                    <td><input type="checkbox" id="conciliarIgnorar-${p.id}-${i}" ${l.ignorar ? 'checked' : ''}></td>
                    <td>${l.dataISO.split('-').reverse().join('/')}</td>
                    <td>${formatarMoeda(l.valor)}</td>
                    <td><span class="chip-tipo chip-tipo--${l.tipo}">${l.tipo === 'entradas' ? 'Receita' : 'Despesa'}</span></td>
                    <td class="import-csv-desc" title="${l.descricao}">${l.descricao}</td>
                </tr>`).join('')}</tbody>
        </table>
    </div>`;
}
