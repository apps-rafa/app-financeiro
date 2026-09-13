/**
 * CONCILIAR PDF
 * Compara a fatura do cartão (Bradesco Cartões) ou o extrato da conta
 * (Mercado Pago) com os lançamentos já registrados no app, e aponta o que
 * está num lado e não no outro. Só relatório — não grava nada no banco.
 * Suporta só esses 2 formatos específicos por enquanto.
 */

let estadoConciliarPDF = null; // { pdfs: [ {..., linhas, transacoes, metodoEscolhido} ] }

function iniciarConciliarPDF() {
    const sec = document.getElementById('secConciliarPDF');
    if (!sec) return;
    estadoConciliarPDF = { pdfs: [] };
    if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    renderConciliarPDF();
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

        const ehRendimento = dNorm.startsWith('rendimentos');
        const ehPouquinho = dNorm.startsWith('dinheiro reservado') || dNorm.startsWith('dinheiro retirado');
        const ehCDB = dNorm.startsWith('liberacao cdb') || dNorm.startsWith('liberacao de cdb');
        const ehPixParaSiMesmo = /^pix (enviado|recebido) rafael loureiro braz$/.test(dNorm);

        linhas.push({
            dataISO: `${ano}-${mes}-${dia}`,
            descricao,
            valorBruto: valor,
            tipo: valor < 0 ? 'saidas' : 'entradas',
            valor: Math.abs(valor),
            ignorarDefault: ehRendimento || ehPouquinho || ehCDB || ehPixParaSiMesmo
        });
    }
    return linhas;
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

async function onConciliarPdfArquivos(e) {
    const files = [...(e.target.files || [])];
    if (!files.length) return;

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
        estadoConciliarPDF.pdfs.push(entrada);
        renderConciliarPDF();

        try {
            const buffer = await file.arrayBuffer();
            const texto = await _extrairTextoPDF(buffer);

            if (_pareceFaturaBradesco(texto)) {
                entrada.formato = 'fatura';
                entrada.linhas = _parsearFaturaBradesco(texto).map(l => ({ ...l, ignorar: l.ignorarDefault }));
                const credito = (estadoApp.menus.metodos || []).find(m => m.metodoKind === 'Crédito');
                entrada.metodoEscolhido = credito ? rotuloMetodo(credito) : '';
            } else if (_pareceExtratoMercadoPago(texto)) {
                entrada.formato = 'extrato';
                entrada.linhas = _parsearExtratoMercadoPago(texto).map(l => ({ ...l, ignorar: l.ignorarDefault }));
                const pix = (estadoApp.menus.metodos || []).find(m => _normalizarTexto(rotuloMetodo(m)).includes('pix'));
                entrada.metodoEscolhido = pix ? rotuloMetodo(pix) : '';
            } else {
                throw new Error('Formato não reconhecido — só suportamos fatura Bradesco Cartões e extrato Mercado Pago por enquanto.');
            }

            if (!entrada.linhas.length) throw new Error('Não encontrei nenhum lançamento nesse PDF.');

            entrada.status = 'pronto';
            await _recompararPDV(entrada);
        } catch (err) {
            console.error('Erro ao processar PDF:', err);
            entrada.status = 'erro';
            entrada.erro = err.message || 'Erro ao ler o PDF';
        }
        renderConciliarPDF();
    }
}

async function _recompararPDV(entrada) {
    const datas = entrada.linhas.map(l => l.dataISO).sort();
    const dataIni = datas[0], dataFim = datas[datas.length - 1];
    const transacoes = await _buscarTransacoesParaConciliar(entrada.metodoEscolhido, dataIni, dataFim);
    entrada.resultado = _conciliar(entrada.linhas, transacoes);
}

/* ---------- Render ---------- */

function renderConciliarPDF() {
    const sec = document.getElementById('secConciliarPDF');
    if (!sec || !estadoConciliarPDF) return;

    sec.innerHTML = `
    <h3>🧾 Conciliar PDF</h3>
    <p class="menu-hint">
        Sobe a fatura do cartão (Bradesco Cartões) ou o extrato da conta (Mercado Pago) em PDF e compara com o que
        já está lançado no app — só aponta as diferenças, não grava nada automaticamente.
    </p>
    <div class="import-csv-upload">
        <input type="file" id="conciliarPdfArquivo" accept=".pdf,application/pdf" multiple>
    </div>
    <div id="conciliarPdfLista"></div>
    `;
    document.getElementById('conciliarPdfArquivo')?.addEventListener('change', onConciliarPdfArquivos);

    const lista = document.getElementById('conciliarPdfLista');
    lista.innerHTML = estadoConciliarPDF.pdfs.map(p => _renderPdfEntrada(p)).join('');

    estadoConciliarPDF.pdfs.forEach(p => {
        document.getElementById(`conciliarMetodo-${p.id}`)?.addEventListener('change', async e => {
            p.metodoEscolhido = e.target.value;
            await _recompararPDV(p);
            renderConciliarPDF();
        });
        (p.linhas || []).forEach((l, i) => {
            document.getElementById(`conciliarIgnorar-${p.id}-${i}`)?.addEventListener('change', e => {
                l.ignorar = e.target.checked;
                _recompararPDV(p).then(renderConciliarPDF);
            });
        });
    });
}

function _renderPdfEntrada(p) {
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
            ${p.linhas.length} linhas no PDF (${totalIgnoradas} ignoradas) —
            <span class="ok">${bateram} bateram</span> ·
            <span class="alerta">${res.noPdfNaoNoApp.length} no PDF mas não no app</span> ·
            <span class="alerta">${res.noAppNaoNoPdf.length} no app mas não no PDF</span>
        </p>

        <div class="import-csv-grupo-titulo">⚠️ No PDF mas não lançado no app (${res.noPdfNaoNoApp.length})</div>
        ${_renderTabelaLinhasPDF(p, res.noPdfNaoNoApp)}

        <div class="import-csv-grupo-titulo">⚠️ Lançado no app mas não no PDF (${res.noAppNaoNoPdf.length})</div>
        ${_renderTabelaTransacoesApp(res.noAppNaoNoPdf)}

        <div class="import-csv-grupo-titulo">Todas as linhas do PDF (marque pra ignorar da comparação)</div>
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
