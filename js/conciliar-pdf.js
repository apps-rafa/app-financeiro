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
/** NÃO reinicia o estado se essa instância já vinha com arquivos carregados
 *  pro mesmo formato — reabrir a aba (ex.: voltar de Despesas) remonta o
 *  HTML do zero via carregarAbaMenus(), mas isso não pode jogar fora a
 *  conferência que o usuário ainda não terminou. Só reinicia de fato
 *  quando o formato mudou (trocou o dropdown) ou é a 1ª vez. Pra recomeçar
 *  do mesmo formato, usa o botão "✕ Recomeçar" (ver _resetarConciliar). */
function _iniciarConciliar(secId, modo, formatoRestrito = null) {
    const sec = document.getElementById(secId);
    if (!sec) return;
    const existente = _estadosConciliar[secId];
    if (!existente || existente.formatoRestrito !== formatoRestrito) {
        _estadosConciliar[secId] = { pdfs: [], formatoRestrito };
    }
    if (modo === 'pdf' && typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    renderConciliar(secId, modo);
}

/** Botão "✕ Recomeçar" — único jeito de zerar de propósito o que já foi
 *  carregado nessa instância (o usuário ainda pode ir e voltar de outras
 *  páginas sem perder nada, ver _iniciarConciliar). */
function _resetarConciliar(secId, modo, formatoRestrito) {
    _estadosConciliar[secId] = { pdfs: [], formatoRestrito };
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

        const valor = _parsearValorUniversal(valorFinalRaw);
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

        let valor = _parsearValorUniversal(valorRaw);
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

/** Parser de valor tolerante a formato — decide sozinho se vírgula ou ponto
 *  é o separador decimal em vez de assumir um só (ex.: Nubank exporta
 *  "273.94", formato americano; assumir vírgula decimal ali — como o resto
 *  do app faz, _parsearValorBR — cortava tudo depois do ponto e perdia os
 *  centavos: "273.94" virava 273).
 *  Regra: se os 2 aparecem, o que vem por ÚLTIMO é o decimal (o outro é
 *  separador de milhar); se só um aparece, é decimal quando tem exatamente
 *  2 dígitos depois (senão é milhar, ex. "1.234" sem centavos). */
function _parsearValorUniversal(s) {
    let str = String(s || '').trim().replace(/\s+/g, '');
    if (!str) return null;
    const negParen = /^\(.*\)$/.test(str);
    str = str.replace(/^[+-]/, '').replace(/[()]/g, '');
    const neg = negParen || /^-/.test(String(s || '').trim());

    const iComma = str.lastIndexOf(','), iDot = str.lastIndexOf('.');
    let normalizado;
    if (iComma > -1 && iDot > -1) {
        normalizado = iComma > iDot
            ? str.replace(/\./g, '').replace(',', '.')   // "1.234,56" -> 1234.56
            : str.replace(/,/g, '');                      // "1,234.56" -> 1234.56
    } else if (iComma > -1) {
        normalizado = str.replace(',', '.');
    } else if (iDot > -1) {
        normalizado = (str.length - iDot - 1 === 2) ? str : str.replace(/\./g, '');
    } else {
        normalizado = str;
    }
    const v = parseFloat(normalizado);
    if (!Number.isFinite(v)) return null;
    return neg ? -v : v;
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
        const valor = _parsearValorUniversal(valorCru);
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

    // Em extratos de várias páginas, cada virada de página repete um rodapé
    // de ajuda/contato (telefones, CNPJ, endereço) seguido do cabeçalho da
    // tabela — esse texto solto entre 2 linhas de verdade podia colar com
    // uma delas e virar um "lançamento" fantasma (data/valor sem sentido,
    // descrição = pedaço do rodapé). Remove antes de casar as linhas.
    texto = texto
        .replace(/Você tem alguma d[uú]vida[\s\S]*?Data Descri[cç][aã]o ID da opera[cç][aã]o Valor Saldo/gi, ' ')
        .replace(/\d{1,2}\/\d{1,2}\s*Data Descri[cç][aã]o ID da opera[cç][aã]o Valor Saldo/gi, ' ');

    const re = /(\d{2})-(\d{2})-(\d{4})\s+(.+?)\s+(\d{10,})\s+R\$\s*(-?[\d.,]+)\s+R\$\s*[\d.,]+/g;
    const linhas = [];
    let m;
    while ((m = re.exec(texto))) {
        const [, dia, mes, ano, descricaoRaw, , valorRaw] = m;
        const descricao = descricaoRaw.trim();
        const dNorm = _normalizarTexto(descricao);
        const valor = _parsearValorUniversal(valorRaw);
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
        const valor = _parsearValorUniversal(valorCru);
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
 *  (o extrato/fatura só cobre esse método). Receitas: se o método é um
 *  cartão de crédito, só entram as que têm esse mesmo método marcado (só
 *  estorno/reembolso lançado na fatura tem método — ver "Reembolso/Estorno"
 *  em js/ui.js); senão nenhuma receita bateria com uma fatura de cartão,
 *  já que salário/freelance/etc. não passam por ele. Pra conta corrente
 *  (Pix/Débito) o comportamento antigo se mantém: qualquer receita sem
 *  método pode ter caído nessa conta, então todas entram na comparação.
 *  `dataIni`/`dataFim` já vêm alargados pro mês CALENDÁRIO inteiro das
 *  competências envolvidas (ver _recompararPDV) — não só o intervalo cru
 *  das linhas do arquivo — porque assinatura recorrente (Mensal/Parcelada)
 *  no cartão é lançada com a data travada no vencimento do cartão, que
 *  pode cair bem longe da data real da cobrança que aparece na fatura. */
async function _buscarTransacoesParaConciliar(metodoDespesa, dataIni, dataFim) {
    const metodoObj = (estadoApp.menus.metodos || []).find(m => rotuloMetodo(m) === metodoDespesa);
    const ehCredito = !!metodoObj && metodoObj.metodoKind === 'Crédito';
    const { data, error } = await sb
        .from('transacoes')
        .select('*')
        .gte('data', dataIni)
        .lte('data', dataFim);
    if (error) { console.error('Erro ao buscar transações pra conciliar:', error); return []; }
    return (data || []).filter(t => {
        if (t.tipo !== 'entradas') return t.metodo === metodoDespesa;
        return t.metodo === metodoDespesa || (!ehCredito && !t.metodo);
    });
}

function _diffDias(iso1, iso2) {
    const a = new Date(iso1 + 'T00:00:00'), b = new Date(iso2 + 'T00:00:00');
    return Math.abs((a - b) / 86400000);
}

/** Casa cada linha do PDF (não ignorada) com uma transação do app (mesmo
 *  tipo, mesmo valor) — cada transação só é usada uma vez.
 *  Data: exige data próxima (±2 dias) pra lançamento Pontual, cuja data É
 *  a data real da compra. Parcelada tem um dia de vencimento próprio por
 *  parcela (não é a data real da cobrança), então pra essas basta a mesma
 *  competência (mês da fatura), calculada com o fechamento do cartão. */
function _conciliar(linhasPDF, transacoesApp, diaFechamento) {
    const pool = transacoesApp.map(t => ({ t, usada: false }));
    const semMatch = [];

    linhasPDF.forEach(l => {
        if (l.ignorar) return;
        const compLinha = typeof competenciaDe === 'function' ? competenciaDe(l.dataISO, diaFechamento || null) : null;
        const candidata = pool.find(p => {
            if (p.usada || p.t.tipo !== l.tipo) return false;
            if (Math.abs(Math.abs(parseFloat(p.t.valor)) - l.valor) >= 0.005) return false;
            const dataTravada = p.t.tipo_recorrencia === 'Parcelada';
            if (dataTravada && compLinha) return p.t.competencia === compLinha;
            return _diffDias(p.t.data, l.dataISO) <= 2;
        });
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
            resultado: null,
            // Itens montados no popup "+" de cada linha, acumulados aqui até
            // o usuário mandar tudo de uma vez (ver _grupoLancamentosFormatados).
            formatados: []
        };
        estado.pdfs.push(entrada);
        renderConciliar(secId, modo);

        try {
            const texto = modo === 'csv' ? await file.text() : await _extrairTextoPDF(await file.arrayBuffer());
            // Prefere o cartão de crédito cujo banco bate com o emissor da fatura
            // (ex.: 2 cartões cadastrados, Bradesco e Nubank — sem isso, uma
            // fatura Nubank podia cair sozinha no primeiro crédito da lista,
            // que podia ser o Bradesco, e a comparação toda saía errada).
            const credito = (bancoAlvo) => {
                const cands = (estadoApp.menus.metodos || []).filter(m => m.metodoKind === 'Crédito');
                const m = (bancoAlvo && cands.find(c => _normalizarTexto(c.banco).includes(bancoAlvo))) || cands[0];
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
                entrada.metodoEscolhido = credito('bradesco');
            } else if (podeBradesco && _pareceFaturaBradescoBoleto(texto)) {
                entrada.formato = 'fatura';
                entrada.linhas = _parsearFaturaBradescoBoleto(texto).map(l => ({ ...l, ignorar: l.ignorarDefault }));
                entrada.metodoEscolhido = credito('bradesco');
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
                entrada.metodoEscolhido = credito('nubank');
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

    const metodoObj = (estadoApp.menus.metodos || []).find(m => rotuloMetodo(m) === entrada.metodoEscolhido);
    const diaFechamento = (metodoObj && metodoObj.metodoKind === 'Crédito') ? metodoObj.diaFechamento : null;

    // Alarga a busca (nunca estreita) pro mês CALENDÁRIO inteiro da
    // competência de cada ponta — uma assinatura Mensal/Parcelada no
    // cartão é lançada com a data travada no vencimento, que pode cair
    // bem fora da janela de dias que a fatura cobre mesmo pertencendo à
    // mesma competência.
    let buscaIni = dataIni, buscaFim = dataFim;
    if (diaFechamento) {
        const [iy, im] = competenciaDe(dataIni, diaFechamento).split('-').map(Number);
        const compIniFirstDay = `${iy}-${String(im).padStart(2, '0')}-01`;
        const [fy, fm] = competenciaDe(dataFim, diaFechamento).split('-').map(Number);
        const compFimLastDay = `${fy}-${String(fm).padStart(2, '0')}-${String(new Date(fy, fm, 0).getDate()).padStart(2, '0')}`;
        if (compIniFirstDay < buscaIni) buscaIni = compIniFirstDay;
        if (compFimLastDay > buscaFim) buscaFim = compFimLastDay;
    }

    const transacoes = await _buscarTransacoesParaConciliar(entrada.metodoEscolhido, buscaIni, buscaFim);
    entrada.resultado = _conciliar(entrada.linhas, transacoes, diaFechamento);
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

    // Lê o estado aberto/fechado ANTES de mexer no innerHTML — sec.innerHTML
    // (embaixo) recria a "listaId" do zero (mesmo id, elemento novo vazio);
    // ler depois disso sempre achava 0 <details>, perdendo o que o usuário
    // tinha aberto/fechado a cada re-render (trocar forma de pgto., marcar
    // "ignorar"...).
    const abertos = _lerAbertosConciliar(document.getElementById(`${secId}Lista`));

    const listaId = `${secId}Lista`;
    const arquivoId = `${secId}Arquivo`;
    const dica = `Sobe ${_rotuloFormatoRestrito(estado.formatoRestrito, modo)} — compara com o que já está lançado
        no app e só aponta as diferenças, não grava nada automaticamente.`;
    const accept = modo === 'pdf' ? '.pdf,application/pdf' : '.csv,text/csv';

    sec.innerHTML = `
    <div class="import-csv-upload">
        <input type="file" id="${arquivoId}" accept="${accept}" multiple>
        <label class="import-csv-upload-label" for="${arquivoId}">📁 Escolher arquivos</label>
        ${estado.pdfs.length ? `<button type="button" class="mini-btn" id="${secId}Recomecar" title="Apaga os arquivos carregados aqui e começa do zero">✕ Recomeçar</button>` : ''}
    </div>
    <p class="menu-hint">${dica}</p>
    <div id="${listaId}"></div>
    `;
    document.getElementById(arquivoId)?.addEventListener('change', e => onConciliarArquivos(e, secId, modo));
    document.getElementById(`${secId}Recomecar`)?.addEventListener('click', () => _resetarConciliar(secId, modo, estado.formatoRestrito));

    const lista = document.getElementById(listaId);
    lista.innerHTML = estado.pdfs.map(p => _renderPdfEntrada(p, modo, abertos, secId)).join('');

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

/** Estado aberto/fechado de cada grupo colapsável (por linha reportada +
 *  entrada) — preservado entre re-renders (marcar "ignorar", trocar a
 *  forma de pgto. etc. refaz o HTML inteiro). Chave ausente = ainda não
 *  visto, cai no padrão de cada grupo (ver _renderPdfEntrada). */
function _lerAbertosConciliar(container) {
    const abertos = {};
    container?.querySelectorAll('details[data-grupo-id]').forEach(d => {
        abertos[d.dataset.grupoId] = d.open;
    });
    return abertos;
}

function _renderPdfEntrada(p, modo, abertos = {}, secId = '') {
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
            <label class="conciliar-pdf-metodo">Forma de pgto. correspondente
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

        ${_grupoColapsavelConciliar({
            id: `${p.id}:formatados`, abertos,
            padraoAberto: p.formatados.length > 0,
            titulo: `📋 Lançamentos formatados (${p.formatados.length})`,
            corpo: _renderTabelaFormatados(p, secId, modo)
        })}

        ${_grupoColapsavelConciliar({
            id: `${p.id}:pdf`, abertos,
            padraoAberto: res.noPdfNaoNoApp.length > 0,
            titulo: `⚠️ No ${rotuloArquivo} mas não lançado no app (${res.noPdfNaoNoApp.length})`,
            corpo: _renderTabelaLinhasPDF(p, res.noPdfNaoNoApp, secId, modo)
        })}

        ${_grupoColapsavelConciliar({
            id: `${p.id}:app`, abertos,
            padraoAberto: res.noAppNaoNoPdf.length > 0,
            titulo: `⚠️ Lançado no app mas não no ${rotuloArquivo} (${res.noAppNaoNoPdf.length})`,
            corpo: _renderTabelaTransacoesApp(res.noAppNaoNoPdf)
        })}

        ${_grupoColapsavelConciliar({
            id: `${p.id}:todas`, abertos,
            padraoAberto: false,
            titulo: `Todas as linhas do ${rotuloArquivo} (marque pra ignorar da comparação)`,
            corpo: _renderTabelaTodasLinhas(p)
        })}
    </div>`;
}

/** Grupo colapsável (⚠️ ...) reutilizado pelas 3 seções do relatório de
 *  conciliação — aberto/fechado por padrão conforme `padraoAberto`
 *  (só usado na 1ª vez que o grupo aparece; depois disso o estado
 *  manual do usuário, lido de `abertos`, sempre vence). */
function _grupoColapsavelConciliar({ id, abertos, padraoAberto, titulo, corpo }) {
    const aberto = abertos[id] !== undefined ? abertos[id] : padraoAberto;
    return `
        <details class="import-csv-grupo" data-grupo-id="${id}" ${aberto ? 'open' : ''}>
          <summary class="import-csv-grupo-titulo">${titulo}</summary>
          ${corpo}
        </details>`;
}

function _renderTabelaLinhasPDF(p, linhas, secId, modo) {
    if (!linhas.length) return `<p class="import-csv-nota">Nenhuma.</p>`;
    return `
    <div class="import-csv-tabela-wrap">
        <table class="import-csv-tabela">
            <thead><tr><th></th><th>Data</th><th>Valor</th><th>Tipo</th><th>Descrição</th></tr></thead>
            <tbody>${linhas.map(l => {
                const idx = p.linhas.indexOf(l);
                const jaFormatado = p.formatados.some(f => f.origemIdx === idx);
                const botao = jaFormatado
                    ? `<button type="button" class="btn-mini-add btn-mini-add--ok" title="Já formatado — clique pra editar"
                            onclick="_abrirLancarConciliar('${secId}','${modo}','${p.id}',${idx})">✓</button>`
                    : `<button type="button" class="btn-mini-add" title="Formatar esse item pra lançar"
                            onclick="_abrirLancarConciliar('${secId}','${modo}','${p.id}',${idx})">+</button>`;
                return `
                <tr>
                    <td>${botao}</td>
                    <td>${l.dataISO.split('-').reverse().join('/')}</td>
                    <td>${formatarMoeda(l.valor)}</td>
                    <td><span class="chip-tipo chip-tipo--${l.tipo}">${l.tipo === 'entradas' ? 'Receita' : 'Despesa'}</span></td>
                    <td class="import-csv-desc" title="${l.descricao}">${l.descricao}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>
    </div>`;
}

/** "+" (ou "✓" se já formatado) de uma linha "no CSV/PDF mas não lançado
 *  no app": popup com os campos do formulário grande (Crédito ganha o
 *  campo Parcelas, com Dia de vencimento quando >1), mas sem sair da tela
 *  de conciliação (trocar pra aba
 *  "+ Lançamento" perderia o arquivo já carregado, já que a aba de
 *  Configuração é remontada do zero sempre que reabre).
 *  O botão NÃO lança na hora — só monta o registro e acumula em
 *  `p.formatados` (grupo "📋 Lançamentos formatados"), pra o usuário
 *  revisar tudo antes de mandar de uma vez (ver _importarFormatados). */
function _abrirLancarConciliar(secId, modo, pId, idx) {
    const estado = _estadosConciliar[secId];
    const p = estado?.pdfs.find(x => x.id === pId);
    const l = p?.linhas[idx];
    if (!l) return;
    const existente = p.formatados.find(f => f.origemIdx === idx);

    const metodoObj = (estadoApp.menus.metodos || []).find(m => rotuloMetodo(m) === p.metodoEscolhido);
    const diaFechamento = (metodoObj && metodoObj.metodoKind === 'Crédito') ? metodoObj.diaFechamento : null;
    const compRaw = diaFechamento && typeof competenciaDe === 'function' ? competenciaDe(l.dataISO, diaFechamento) : l.dataISO.slice(0, 7);
    const competencia = /^\d{4}-\d{2}$/.test(compRaw) ? `${compRaw}-01` : compRaw;

    const categorias = l.tipo === 'entradas'
        ? (estadoApp.menus.categoriasReceita || [])
        : (estadoApp.menus.categoriasDespesa || []);
    const sugestao = existente ? existente.dados.categoria
        : (typeof _resolverCategoria === 'function' ? _resolverCategoria(l.descricao, l.tipo) : null);
    const diaPadrao = parseInt(l.dataISO.slice(8, 10), 10);
    const esc = s => String(s || '').replace(/"/g, '&quot;');

    // "Parcelas" só existe pra Crédito — mesmo gatilho do formulário grande
    // (ver atualizarCampoParcelas, js/ui.js): 1x = avulso de sempre, >1 = compra
    // parcelada.
    const ehCredito = !!metodoObj && metodoObj.metodoKind === 'Crédito';
    const diaRecPadrao = existente ? existente.dados.diaRecorrencia : diaPadrao;
    const parcelasPadrao = existente ? (existente.dados.parcelas || 1) : 1;

    const ov = mostrarDialogo({
        titulo: existente ? 'Editar lançamento formatado' : 'Formatar lançamento',
        corpoHTML: `
            <p class="import-csv-nota">
                ${l.dataISO.split('-').reverse().join('/')} · ${formatarMoeda(l.valor)} ·
                ${l.tipo === 'entradas' ? 'Receita' : 'Despesa'} · ${esc(p.metodoEscolhido)}
            </p>
            <div class="form-group">
                <label for="lcDescricao">Descrição</label>
                <input type="text" id="lcDescricao" value="${esc(existente ? existente.dados.descricao : l.descricao)}">
            </div>
            <div class="form-group">
                <label for="lcCategoria">Categoria</label>
                <select id="lcCategoria">
                    <option value="">Selecione...</option>
                    ${categorias.map(c => `<option value="${esc(c)}" ${c === sugestao ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            </div>
            <div id="lcParcelasWrap" ${ehCredito ? '' : 'hidden'} style="display:flex;gap:.5rem">
                <div class="form-group" style="flex:1">
                    <label for="lcParcelas">Parcelas</label>
                    <input type="number" id="lcParcelas" min="1" value="${parcelasPadrao}">
                </div>
                <div class="form-group" id="lcDiaVencimentoWrap" hidden style="flex:1">
                    <label for="lcDiaVencimento">Dia de vencimento</label>
                    <input type="number" id="lcDiaVencimento" min="1" max="31" value="${diaRecPadrao}">
                </div>
            </div>
        `,
        acoes: [
            { label: 'Cancelar' },
            ...(existente ? [{
                label: 'Remover', perigo: true,
                onClick: () => {
                    p.formatados = p.formatados.filter(f => f.origemIdx !== idx);
                    renderConciliar(secId, modo);
                }
            }] : []),
            {
                label: existente ? 'Salvar' : 'Adicionar', primario: true,
                onClick: () => {
                    const categoria = document.getElementById('lcCategoria').value;
                    if (!categoria) { mostrarNotificacao('Escolha uma categoria', 'erro'); return true; }
                    const descricao = document.getElementById('lcDescricao').value.trim();
                    const parcelas = ehCredito ? (parseInt(document.getElementById('lcParcelas').value, 10) || 1) : 1;
                    const tipoRecorrencia = parcelas > 1 ? 'Parcelada' : 'Pontual';
                    const diaRecorrencia = tipoRecorrencia === 'Parcelada' ? (document.getElementById('lcDiaVencimento').value || '') : '';
                    if (tipoRecorrencia === 'Parcelada' && !(parseInt(diaRecorrencia, 10) >= 1 && parseInt(diaRecorrencia, 10) <= 31)) {
                        mostrarNotificacao('Informe o dia de vencimento (1 a 31)', 'erro'); return true;
                    }

                    const dados = {
                        tipo: l.tipo, data: l.dataISO, valor: l.valor, metodo: p.metodoEscolhido,
                        categoria, descricao, formaPagamento: tipoRecorrencia === 'Parcelada' ? 'Parcelada' : 'À vista',
                        tipoRecorrencia, diaRecorrencia, parcelas, competencia, origem: 'pdf',
                        // Como veio extraído do PDF, antes do usuário escolher
                        // categoria/descrição neste popup.
                        dadosOriginais: {
                            dataISO: l.dataISO,
                            descricao: l.descricao,
                            valorBruto: l.valorBruto,
                            tipo: l.tipo,
                        },
                    };
                    if (existente) {
                        existente.dados = dados;
                    } else {
                        p.formatados.push({ origemIdx: idx, dados });
                    }
                    renderConciliar(secId, modo);
                }
            }
        ]
    });

    const $ = sel => ov.querySelector(sel);
    if (ehCredito) {
        const aplicarVisibilidade = () => {
            const parcelas = parseInt($('#lcParcelas').value, 10) || 1;
            $('#lcDiaVencimentoWrap').hidden = parcelas <= 1;
        };
        $('#lcParcelas').addEventListener('input', aplicarVisibilidade);
        aplicarVisibilidade();
    }
}

function _renderTabelaFormatados(p, secId, modo) {
    const prontos = p.formatados.length;
    const linhas = p.formatados.length ? `
    <div class="import-csv-tabela-wrap">
        <table class="import-csv-tabela">
            <thead><tr><th></th><th>Data</th><th>Valor</th><th>Tipo</th><th>Categoria</th><th>Parcelas</th><th>Descrição</th></tr></thead>
            <tbody>${p.formatados.map(f => `
                <tr>
                    <td><button type="button" class="btn-icon btn-danger" title="Remover"
                            onclick="_removerFormatado('${secId}','${modo}','${p.id}',${f.origemIdx})">🗑️</button></td>
                    <td>${f.dados.data.split('-').reverse().join('/')}</td>
                    <td>${formatarMoeda(f.dados.valor)}</td>
                    <td><span class="chip-tipo chip-tipo--${f.dados.tipo}">${f.dados.tipo === 'entradas' ? 'Receita' : 'Despesa'}</span></td>
                    <td>${f.dados.categoria}</td>
                    <td>${f.dados.parcelas > 1 ? `${f.dados.parcelas}x` : 'à vista'}</td>
                    <td class="import-csv-desc" title="${f.dados.descricao}">${f.dados.descricao}</td>
                </tr>`).join('')}</tbody>
        </table>
    </div>` : `<p class="import-csv-nota">Use o "+" nas linhas de cima pra formatar e acumular aqui.</p>`;

    return `
    ${linhas}
    <div class="import-csv-acoes">
        <button type="button" class="btn-submit" ${prontos ? '' : 'disabled'}
                onclick="_importarFormatados('${secId}','${modo}','${p.id}')">
            Importar ${prontos} lançamento${prontos === 1 ? '' : 's'}
        </button>
    </div>`;
}

function _removerFormatado(secId, modo, pId, origemIdx) {
    const p = _estadosConciliar[secId]?.pdfs.find(x => x.id === pId);
    if (!p) return;
    p.formatados = p.formatados.filter(f => f.origemIdx !== origemIdx);
    renderConciliar(secId, modo);
}

/** Manda de uma vez todos os itens acumulados em "Lançamentos formatados"
 *  — mesma API que o resto do app usa (adicionarTransacaoAPI), um de cada
 *  vez. No final recalcula a comparação (os que deram certo somem de "não
 *  lançado no app") e limpa a lista formatada. */
async function _importarFormatados(secId, modo, pId) {
    const p = _estadosConciliar[secId]?.pdfs.find(x => x.id === pId);
    if (!p || !p.formatados.length) return;

    let ok = 0, falhas = 0;
    for (const f of p.formatados) {
        try {
            await adicionarTransacaoAPI(f.dados);
            ok++;
        } catch (err) {
            console.error('Erro ao importar lançamento formatado:', f, err);
            falhas++;
        }
    }
    p.formatados = [];
    await _recompararPDV(p);
    renderConciliar(secId, modo);
    if (typeof recarregarDados === 'function') await recarregarDados();
    if (typeof atualizarUI === 'function') atualizarUI();
    mostrarNotificacao(falhas ? `${ok} lançados, ${falhas} falharam` : `✓ ${ok} lançamento${ok === 1 ? '' : 's'} criado${ok === 1 ? '' : 's'}`,
        falhas ? 'erro' : 'sucesso');
}

function _renderTabelaTransacoesApp(transacoes) {
    if (!transacoes.length) return `<p class="import-csv-nota">Nenhuma.</p>`;
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
