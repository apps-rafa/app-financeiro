/**
 * VISÃO ANUAL — página própria (#anual, botão 📈 do cabeçalho) pra comparar e
 * acompanhar mês a mês os gastos (ou receitas) do ano, por categoria ou por
 * forma de pagamento. Ao abrir, esconde o resto do app (classe body.modo-anual);
 * clicar no botão de novo volta ao normal.
 *
 * - O gráfico é a primeira linha da própria tabela (barras empilhadas, uma cor
 *   por categoria/forma), então cada barra fica exatamente sobre o seu mês.
 * - Meses passados sem nenhum lançamento não aparecem.
 * - Filtro por uma categoria/forma, comparação entre DOIS MESES e foco num mês
 *   (tocar no nome do mês destaca aquele mês nos cartões, no gráfico e na tabela).
 * Mesma regra do dashboard: receita com forma "Crédito" é estorno/reembolso e
 * abate a despesa desse cartão.
 * (A comparação ano x ano existiu na 1ª versão — PR #248 — e foi tirada da tela.)
 */

const MESES_ANUAL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_ANUAL_LONGO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const estadoAnual = {
    ano: new Date().getFullYear(),
    agrupar: 'categoria', // 'categoria' | 'metodo'
    filtro: '',           // nome de uma linha (categoria/forma) ou '' = todas
    cmp: { ativo: false, a: null, b: null }, // comparação de dois meses (0-11)
    porAno: {},           // ano -> transações
    foco: null,           // mês (0-11) em foco ao tocar no cabeçalho; null = ano todo
    carregando: false,
};

/** Todas as transações do ano (a API devolve no máximo 1000 por chamada). */
async function _buscarTransacoesDoAno(ano) {
    const todas = [];
    for (let ini = 0; ; ini += 1000) {
        const { data, error } = await sb.from('transacoes')
            .select('id, tipo, valor, categoria, metodo, competencia')
            .gte('competencia', `${ano}-01-01`).lt('competencia', `${ano + 1}-01-01`)
            .order('id').range(ini, ini + 999);
        if (error) throw error;
        todas.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    return todas;
}

const _brl0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const _brl2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const _anualOculto = () => typeof valoresOcultos !== 'undefined' && valoresOcultos;
const _fmtCel = v => (_anualOculto() ? '••' : _brl0.format(Math.round(v)));
const _fmtMoeda = v => (_anualOculto() ? 'R$ ••••' : _brl2.format(v));
const _esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "PIX Mercado pago" e "PIX" são a mesma forma (tudo é PIX). */
function _chaveMetodoAnual(m) {
    const s = String(m || '').trim();
    if (!s) return '(sem forma)';
    return /^pix(\s|$)/i.test(s) ? 'PIX' : s;
}

/** {linhas:[{nome, meses:[12], total}], temEstorno} do ano, com o tipo/agrupamento atuais. */
function _calcularAno(linhas, tipo) {
    const { agrupar } = estadoAnual;
    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const rotulosCredito = new Set(metodos
        .filter(m => m.metodoKind === 'Crédito')
        .map(m => (typeof rotuloMetodo === 'function' ? rotuloMetodo(m) : m.nome)));
    const mapa = new Map();
    const somar = (nome, mes, valor) => {
        if (!mapa.has(nome)) mapa.set(nome, Array(12).fill(0));
        mapa.get(nome)[mes] += valor;
    };
    let temEstorno = false;
    for (const t of linhas || []) {
        const mes = parseInt(String(t.competencia).slice(5, 7), 10) - 1;
        if (!(mes >= 0 && mes < 12)) continue;
        const valor = Number(t.valor) || 0;
        const estorno = t.tipo === 'entradas' && rotulosCredito.has(t.metodo);
        const nomeLinha = agrupar === 'categoria' ? (t.categoria || '(sem categoria)') : _chaveMetodoAnual(t.metodo);
        if (tipo === 'saidas') {
            if (t.tipo === 'saidas') somar(nomeLinha, mes, valor);
            else if (estorno) {
                temEstorno = true;
                // Estorno abate a fatura do cartão (por forma) ou vira uma linha própria (por categoria)
                somar(agrupar === 'categoria' ? '(−) Estornos no cartão' : _chaveMetodoAnual(t.metodo), mes, -valor);
            }
        } else if (t.tipo === 'entradas' && !estorno) {
            somar(nomeLinha, mes, valor);
        }
    }
    const lista = [...mapa.entries()].map(([nome, meses]) => ({ nome, meses, total: meses.reduce((a, b) => a + b, 0) }))
        .filter(l => l.meses.some(v => Math.abs(v) > 0.004))
        .sort((a, b) => (a.nome.startsWith('(−)') ? 1 : 0) - (b.nome.startsWith('(−)') ? 1 : 0) || b.total - a.total);
    return { linhas: lista, temEstorno };
}

/** Aplica o filtro (uma linha só) e soma os totais mensais. */
function _visao(ano, tipo) {
    const base = _calcularAno(estadoAnual.porAno[ano], tipo);
    const linhas = estadoAnual.filtro ? base.linhas.filter(l => l.nome === estadoAnual.filtro) : base.linhas;
    const totais = Array(12).fill(0);
    linhas.forEach(l => l.meses.forEach((v, i) => { totais[i] += v; }));
    return { todas: base.linhas, linhas, totais, temEstorno: base.temEstorno };
}

function _corDoNomeAnual(nome) {
    const cores = (estadoApp.menus && estadoApp.menus.cores) || {};
    const mapa = estadoAnual.agrupar === 'categoria' ? cores.categoria : cores.metodo;
    return (mapa && mapa[nome]) || (typeof corPadraoChip === 'function' ? corPadraoChip(nome) : '#6366F1');
}

function _pct(atual, anterior) {
    return anterior ? ((atual - anterior) / Math.abs(anterior)) * 100 : null;
}
const _fmtPct = p => (p === null ? '–' : `${p > 0 ? '+' : ''}${p.toFixed(0)}%`);

/** Meses que aparecem: os que têm lançamento + os de hoje em diante (planejamento). */
function _mesesVisiveis(conjuntos, ano) {
    const hoje = new Date();
    const futuroDesde = ano > hoje.getFullYear() ? 0 : (ano === hoje.getFullYear() ? hoje.getMonth() : 12);
    return MESES_ANUAL.map((_, i) => i).filter(i => i >= futuroDesde || conjuntos.some(c => c.some(l => Math.abs(l.meses[i]) > 0.004)));
}

/** Linha do gráfico (1ª linha da tabela): DUAS barras por mês — receita (esquerda) e despesa
 *  (direita) — cada uma empilhada com uma cor por categoria/forma, na mesma escala. */
function _linhaGrafico(linhasR, linhasD, meses, mesAtual, dim = () => '') {
    const soma = (linhas, i) => linhas.filter(l => !l.nome.startsWith('(−)')).reduce((a, l) => a + Math.max(0, l.meses[i]), 0);
    const max = Math.max(...meses.flatMap(i => [soma(linhasR, i), soma(linhasD, i)]), 1);
    const ALTURA = 130;
    const barra = (linhas, i, classe, rotulo) => {
        const positivos = linhas.filter(l => !l.nome.startsWith('(−)') && l.meses[i] > 0.004);
        const total = soma(linhas, i);
        const h = total > 0 ? Math.max(4, (total / max) * ALTURA) : 0;
        const segs = positivos.map(l => `<span class="seg" style="flex:${l.meses[i]};background:${_corDoNomeAnual(l.nome)}" title="${rotulo} · ${_esc(l.nome)} · ${MESES_ANUAL_LONGO[i]}: ${_fmtMoeda(l.meses[i])} (${Math.round(l.meses[i] / total * 100)}%)"></span>`).join('');
        return `<div class="barra ${classe}" style="height:${h.toFixed(0)}px" title="${rotulo} de ${MESES_ANUAL_LONGO[i]}: ${_fmtMoeda(total)}">${segs}</div>`;
    };
    const cels = meses.map(i => `<td class="grafico-cel${i === mesAtual ? ' atual' : ''}${dim(i)}"><div class="par">${barra(linhasR, i, 'rec', 'Receita')}${barra(linhasD, i, 'desp', 'Despesa')}</div></td>`).join('');
    return `<tr class="grafico-linha"><th class="anual-nome grafico-rot"></th>${cels}<td class="grafico-cel"></td></tr>`;
}

/** Nome de categoria/forma: inteiro no desktop, abreviado no celular (nunca termina em "…"). */
function _nomeCurto(nome) {
    const curto = typeof abreviarCategoria === 'function' ? abreviarCategoria(nome) : nome;
    if (curto === nome || String(nome).length <= 12) return _esc(nome);
    return `<span class="nm-full">${_esc(nome)}</span><span class="nm-curto">${_esc(curto)}</span>`;
}

const _ehNeg = nome => nome.startsWith('(−)');

/** Seção da tabela (Despesas ou Receitas): título, uma linha por categoria/forma, total e variação. */
function _secaoTabela({ rotulo, tipo, v, meses, mesAtual, ultimoMes, dim }) {
    const { linhas, totais } = v;
    if (!linhas.length) return { html: '', totais };
    const maxCel = Math.max(1, ...linhas.flatMap(l => l.meses.map(x => Math.abs(x))));
    const corHeat = tipo === 'entradas' ? 'var(--receita-text)' : 'var(--despesa-text)';
    const totalAno = totais.reduce((a, b) => a + b, 0);
    const corpo = linhas.map(l => {
        const neg = _ehNeg(l.nome);
        const cel = meses.map(i => {
            const x = l.meses[i];
            if (Math.abs(x) < 0.005) return `<td class="vazio${dim(i)}">–</td>`;
            const forca = Math.round(8 + 42 * Math.min(1, Math.abs(x) / maxCel));
            return `<td class="cel${i === mesAtual ? ' atual' : ''}${dim(i)}" style="background:color-mix(in srgb, ${neg ? 'var(--receita-text)' : corHeat} ${forca}%, transparent)" title="${_esc(l.nome)} · ${MESES_ANUAL_LONGO[i]}: ${_fmtMoeda(x)}">${_fmtCel(x)}</td>`;
        }).join('');
        const ponto = neg ? '' : `<i class="anual-ponto" style="background:${_corDoNomeAnual(l.nome)}"></i>`;
        const alvo = neg ? '' : ` data-anual-linha="${_esc(l.nome)}" title="Filtrar só ${_esc(l.nome)}"`;
        return `<tr><th scope="row" class="anual-nome${neg ? '' : ' clicavel'}"${alvo}>${ponto}<span>${_nomeCurto(l.nome)}</span></th>${cel}<td class="total">${_fmtCel(l.total)}</td></tr>`;
    }).join('');
    const deltas = meses.map(i => {
        if (i === 0 || !totais[i - 1] || (ultimoMes >= 0 && i > ultimoMes)) return `<td class="vazio${dim(i)}">–</td>`;
        const p = _pctTipo(tipo, totais[i], totais[i - 1]);
        return `<td class="delta ${p.classe}${dim(i)}">${_fmtPct(p.valor)}</td>`;
    }).join('');
    const html = `
        <tr class="sec ${tipo === 'entradas' ? 'rec' : 'desp'}"><th class="anual-nome sec-tit">${rotulo}</th><td colspan="${meses.length + 1}"></td></tr>
        ${corpo}
        <tr class="tot"><th scope="row" class="anual-nome">Total ${rotulo.toLowerCase()}</th>${meses.map(i => `<td class="${i === mesAtual ? 'atual' : ''}${dim(i)}">${totais[i] ? _fmtCel(totais[i]) : '–'}</td>`).join('')}<td class="total">${_fmtCel(totalAno)}</td></tr>
        <tr class="var"><th scope="row" class="anual-nome">vs. mês anterior</th>${deltas}<td></td></tr>`;
    return { html, totais };
}

/** Variação % + classe (bom/ruim) considerando o tipo: despesa subir é ruim, receita subir é bom. */
function _pctTipo(tipo, atual, anterior) {
    const valor = _pct(atual, anterior);
    if (valor === null || Math.abs(valor) < 0.5) return { valor, classe: '' };
    const bom = tipo === 'entradas' ? valor > 0 : valor < 0;
    return { valor, classe: bom ? 'bom' : 'ruim' };
}

function _renderComparacaoMeses(vD, vR, ref) {
    const c = estadoAnual.cmp;
    if (!c.ativo) return '';
    if (c.a === null) c.a = ref;
    if (c.b === null) c.b = ref > 0 ? ref - 1 : Math.min(11, ref + 1);
    const opcoes = sel => MESES_ANUAL_LONGO.map((m, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${m}</option>`).join('');
    const bloco = (rotulo, tipo, v) => {
        const ls = v.linhas.map(l => ({ nome: l.nome, a: l.meses[c.a], b: l.meses[c.b] }))
            .filter(l => Math.abs(l.a) > 0.004 || Math.abs(l.b) > 0.004)
            .map(l => ({ ...l, d: l.a - l.b, p: _pctTipo(tipo, l.a, l.b) }))
            .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
        if (!ls.length) return '';
        const tA = ls.reduce((a, l) => a + l.a, 0), tB = ls.reduce((a, l) => a + l.b, 0);
        const pT = _pctTipo(tipo, tA, tB);
        const linhas = ls.map(l => `<tr><th scope="row" class="anual-nome"><i class="anual-ponto" style="background:${_corDoNomeAnual(l.nome)}"></i><span>${_nomeCurto(l.nome)}</span></th>
            <td>${l.a ? _fmtCel(l.a) : '–'}</td><td>${l.b ? _fmtCel(l.b) : '–'}</td>
            <td class="delta ${l.p.classe || (l.p.valor === null ? _pctTipo(tipo, l.d, 0).classe : '')}">${l.d > 0 ? '+' : ''}${_fmtCel(l.d)}</td>
            <td class="delta ${l.p.classe}">${_fmtPct(l.p.valor)}</td></tr>`).join('');
        return `<tr class="sec ${tipo === 'entradas' ? 'rec' : 'desp'}"><th class="anual-nome sec-tit">${rotulo}</th><td colspan="4"></td></tr>${linhas}
            <tr class="tot"><th scope="row" class="anual-nome">Total ${rotulo.toLowerCase()}</th><td>${_fmtCel(tA)}</td><td>${_fmtCel(tB)}</td><td class="delta ${pT.classe}">${tA - tB > 0 ? '+' : ''}${_fmtCel(tA - tB)}</td><td class="delta ${pT.classe}">${_fmtPct(pT.valor)}</td></tr>`;
    };
    const corpo = bloco('Despesas', 'saidas', vD) + bloco('Receitas', 'entradas', vR);
    return `<div class="anual-bloco anual-cmp">
        <div class="anual-cmp-topo">
            <b>Comparar meses</b>
            <select id="anualCmpA" aria-label="Mês A">${opcoes(c.a)}</select>
            <span>com</span>
            <select id="anualCmpB" aria-label="Mês B">${opcoes(c.b)}</select>
            <button type="button" class="anual-toggle" data-anual-cmp-inverter title="Trocar A e B">⇅</button>
        </div>
        ${corpo ? `<div class="anual-tabela-wrap"><table class="anual-tabela anual-tabela-cmp">
            <thead><tr><th class="anual-nome">${estadoAnual.agrupar === 'categoria' ? 'Categoria' : 'Forma de pgto.'}</th><th>${MESES_ANUAL[c.a]}</th><th>${MESES_ANUAL[c.b]}</th><th>Diferença</th><th>%</th></tr></thead>
            <tbody>${corpo}</tbody>
        </table></div>` : '<p class="empty-message">Nada lançado nesses meses.</p>'}
    </div>`;
}

function _renderVisaoAnual() {
    const cont = document.getElementById('anualConteudo');
    if (!cont) return;
    const { ano, agrupar } = estadoAnual;
    const vD = _visao(ano, 'saidas');
    const vR = _visao(ano, 'entradas');
    const hoje = new Date();
    const mesAtual = hoje.getFullYear() === ano ? hoje.getMonth() : -1;
    const ultimoMes = hoje.getFullYear() === ano ? hoje.getMonth() : (ano < hoje.getFullYear() ? 11 : -1);
    const meses = _mesesVisiveis([vD.todas, vR.todas], ano);
    const foco = estadoAnual.foco;
    const dim = i => (foco !== null && i !== foco ? ' dim' : '') + (foco === i ? ' foco' : '');
    const ref = Math.max(0, ultimoMes);
    const sD = vD.totais.reduce((a, b) => a + b, 0), sR = vR.totais.reduce((a, b) => a + b, 0);
    const saldos = vR.totais.map((r, i) => r - vD.totais[i]);
    const fmtVar = p => (p === null ? '—' : `${p > 0 ? '▲' : p < 0 ? '▼' : ''} ${Math.abs(p).toFixed(0)}%`);
    const sinal = x => (x > 0 ? '+' : '');

    // Cartões: ano todo, ou o mês em foco
    let cartoes;
    if (foco === null) {
        const dec = ultimoMes + 1;
        const mediaD = dec ? vD.totais.slice(0, dec).reduce((a, b) => a + b, 0) / dec : 0;
        cartoes = `
            <div class="anual-card"><span>Receitas no ano</span><b class="bom">${_fmtMoeda(sR)}</b></div>
            <div class="anual-card"><span>Despesas no ano</span><b class="ruim">${_fmtMoeda(sD)}</b></div>
            <div class="anual-card"><span>Saldo do ano</span><b class="${sR - sD >= 0 ? 'bom' : 'ruim'}">${sinal(sR - sD)}${_fmtMoeda(sR - sD)}</b></div>
            <div class="anual-card"><span>Despesa média por mês</span><b>${_fmtMoeda(mediaD)}</b></div>`;
    } else {
        const pD = foco > 0 ? _pctTipo('saidas', vD.totais[foco], vD.totais[foco - 1]) : { valor: null, classe: '' };
        cartoes = `
            <div class="anual-card foco"><span>Receitas em ${MESES_ANUAL_LONGO[foco]}</span><b class="bom">${_fmtMoeda(vR.totais[foco])}</b></div>
            <div class="anual-card foco"><span>Despesas em ${MESES_ANUAL_LONGO[foco]}</span><b class="ruim">${_fmtMoeda(vD.totais[foco])}</b></div>
            <div class="anual-card foco"><span>Saldo do mês</span><b class="${saldos[foco] >= 0 ? 'bom' : 'ruim'}">${sinal(saldos[foco])}${_fmtMoeda(saldos[foco])}</b></div>
            <div class="anual-card foco"><span>Despesa vs. ${foco > 0 ? MESES_ANUAL_LONGO[foco - 1] : 'mês anterior'}</span><b class="${pD.classe}">${fmtVar(pD.valor)}</b></div>`;
    }

    // Opções do filtro (categorias/formas de receita e despesa juntas)
    const nomes = new Map();
    [...vD.todas, ...vR.todas].filter(l => !_ehNeg(l.nome)).forEach(l => nomes.set(l.nome, (nomes.get(l.nome) || 0) + Math.abs(l.total)));
    const opcoes = [...nomes.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => `<option value="${_esc(n)}"${n === estadoAnual.filtro ? ' selected' : ''}>${_esc(n)}</option>`).join('');
    const rotuloTodas = agrupar === 'categoria' ? 'Todas as categorias' : 'Todas as formas';

    const secD = _secaoTabela({ rotulo: 'Despesas', tipo: 'saidas', v: vD, meses, mesAtual, ultimoMes, dim });
    const secR = _secaoTabela({ rotulo: 'Receitas', tipo: 'entradas', v: vR, meses, mesAtual, ultimoMes, dim });
    const temDados = !!(secD.html || secR.html);
    const saldoLinha = `<tr class="saldo"><th scope="row" class="anual-nome">Saldo (receitas − despesas)</th>${meses.map(i => `<td class="${saldos[i] >= 0 ? 'bom' : 'ruim'}${i === mesAtual ? ' atual' : ''}${dim(i)}">${(vR.totais[i] || vD.totais[i]) ? sinal(saldos[i]) + _fmtCel(saldos[i]) : '–'}</td>`).join('')}<td class="total ${sR - sD >= 0 ? 'bom' : 'ruim'}">${sinal(sR - sD)}${_fmtCel(sR - sD)}</td></tr>`;

    cont.innerHTML = `
        <div class="anual-filtros">
            <select id="anualFiltro" aria-label="Filtrar"><option value="">${rotuloTodas}</option>${opcoes}</select>
            <button type="button" class="anual-toggle${estadoAnual.cmp.ativo ? ' active' : ''}" data-anual-cmp title="Comparar dois meses">⇄ Comparar meses</button>
            ${foco !== null ? `<button type="button" class="anual-toggle active" data-foco-limpar title="Voltar a ver o ano todo">${MESES_ANUAL_LONGO[foco]} ✕</button>` : ''}
        </div>
        <div class="anual-cards">${cartoes}</div>
        ${_renderComparacaoMeses(vD, vR, ref)}
        ${temDados ? `
        <div class="anual-tabela-wrap anual-bloco">
            <table class="anual-tabela">
                <thead>
                    ${_linhaGrafico(vR.linhas, vD.linhas, meses, mesAtual, dim)}
                    <tr><th class="anual-nome">${agrupar === 'categoria' ? 'Categoria' : 'Forma de pgto.'}</th>
                    ${meses.map(i => `<th class="mes${i === mesAtual ? ' atual' : ''}${dim(i)}"><button type="button" data-foco-mes="${i}" title="Focar em ${MESES_ANUAL_LONGO[i]}">${MESES_ANUAL[i]}</button></th>`).join('')}
                    <th class="total">Total</th></tr>
                </thead>
                <tbody>${secD.html}${secR.html}</tbody>
                <tfoot>${saldoLinha}</tfoot>
            </table>
        </div>
        <p class="menu-hint anual-nota">Valores em R$ (sem centavos), pelo mês da competência${(vD.temEstorno) ? '; estornos/reembolsos no cartão abatem a despesa' : ''}. No gráfico, a barra da esquerda é a receita e a da direita a despesa do mês, coloridas pela proporção de cada ${agrupar === 'categoria' ? 'categoria' : 'forma de pagamento'}. Meses passados sem lançamento não aparecem. Toque no nome de um mês para focar nele (toque de novo para voltar ao ano) e no nome de uma ${agrupar === 'categoria' ? 'categoria' : 'forma'} para filtrá-la.</p>`
        : `<p class="empty-message">Nada lançado em ${ano}${estadoAnual.filtro ? ` para “${_esc(estadoAnual.filtro)}”` : ''}.</p>`}`;
}

/** Abre a página, carrega o ano e desenha. */
async function carregarVisaoAnual(forcar = false) {
    const cont = document.getElementById('anualConteudo');
    if (!cont || estadoAnual.carregando) return;
    document.getElementById('anualAno').textContent = estadoAnual.ano;
    document.querySelectorAll('#anual [data-anual-agrupar]').forEach(b => b.classList.toggle('active', b.dataset.anualAgrupar === estadoAnual.agrupar));
    if (forcar || !estadoAnual.porAno[estadoAnual.ano]) {
        estadoAnual.carregando = true;
        cont.innerHTML = '<p class="loading">Carregando...</p>';
        try {
            estadoAnual.porAno[estadoAnual.ano] = await _buscarTransacoesDoAno(estadoAnual.ano);
        } catch (e) {
            console.error(e);
            cont.innerHTML = '<p class="empty-message">Erro ao carregar o ano</p>';
            return;
        } finally {
            estadoAnual.carregando = false;
        }
    }
    _renderVisaoAnual();
}

function iniciarVisaoAnual() {
    const aba = document.getElementById('anual');
    if (!aba) return;
    aba.addEventListener('click', async e => {
        const btnAgr = e.target.closest('[data-anual-agrupar]');
        const btnAno = e.target.closest('[data-anual-ano]');
        const btnMes = e.target.closest('[data-foco-mes]');
        const linha = e.target.closest('[data-anual-linha]');
        if (btnAgr) { estadoAnual.agrupar = btnAgr.dataset.anualAgrupar; estadoAnual.filtro = ''; carregarVisaoAnual(); }
        else if (btnAno) { estadoAnual.ano += Number(btnAno.dataset.anualAno); estadoAnual.filtro = ''; estadoAnual.foco = null; estadoAnual.cmp.a = estadoAnual.cmp.b = null; carregarVisaoAnual(); }
        else if (e.target.closest('[data-anual-cmp]')) { estadoAnual.cmp.ativo = !estadoAnual.cmp.ativo; _renderVisaoAnual(); }
        else if (e.target.closest('[data-anual-cmp-inverter]')) { const c = estadoAnual.cmp; [c.a, c.b] = [c.b, c.a]; _renderVisaoAnual(); }
        else if (btnMes) { const m = Number(btnMes.dataset.focoMes); estadoAnual.foco = estadoAnual.foco === m ? null : m; _renderVisaoAnual(); }
        else if (linha) { estadoAnual.filtro = estadoAnual.filtro === linha.dataset.anualLinha ? '' : linha.dataset.anualLinha; _renderVisaoAnual(); }
        else if (e.target.closest('[data-foco-limpar]')) { estadoAnual.foco = null; _renderVisaoAnual(); }
    });
    aba.addEventListener('change', e => {
        if (e.target.id === 'anualFiltro') { estadoAnual.filtro = e.target.value; _renderVisaoAnual(); }
        else if (e.target.id === 'anualCmpA') { estadoAnual.cmp.a = Number(e.target.value); _renderVisaoAnual(); }
        else if (e.target.id === 'anualCmpB') { estadoAnual.cmp.b = Number(e.target.value); _renderVisaoAnual(); }
    });
}
