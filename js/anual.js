/**
 * VISÃO ANUAL — página própria (#anual, botão 📈 do cabeçalho) pra comparar e
 * acompanhar mês a mês os gastos (ou receitas) do ano, por categoria ou por
 * forma de pagamento. Ao abrir, esconde o resto do app (classe body.modo-anual);
 * clicar no botão de novo volta ao normal.
 *
 * - O gráfico é a primeira linha da própria tabela (barras empilhadas, uma cor
 *   por categoria/forma), então cada barra fica exatamente sobre o seu mês.
 * - Meses passados sem nenhum lançamento não aparecem.
 * - Filtro por uma categoria/forma, comparação entre DOIS MESES e orçamento
 *   mensal por categoria de despesa (tabela `orcamentos`).
 * Mesma regra do dashboard: receita com forma "Crédito" é estorno/reembolso e
 * abate a despesa desse cartão.
 * (A comparação ano x ano existiu na 1ª versão — PR #248 — e foi tirada da tela.)
 */

const MESES_ANUAL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_ANUAL_LONGO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const estadoAnual = {
    ano: new Date().getFullYear(),
    tipo: 'saidas',       // 'saidas' | 'entradas'
    agrupar: 'categoria', // 'categoria' | 'metodo'
    filtro: '',           // nome de uma linha (categoria/forma) ou '' = todas
    cmp: { ativo: false, a: null, b: null }, // comparação de dois meses (0-11)
    porAno: {},           // ano -> transações
    orcamentos: {},       // categoria -> valor mensal
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

async function _carregarOrcamentos() {
    const { data, error } = await sb.from('orcamentos').select('categoria, valor');
    if (error) { console.warn('Orçamentos indisponíveis:', error.message); return; }
    estadoAnual.orcamentos = Object.fromEntries((data || []).map(o => [o.categoria, Number(o.valor)]));
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
function _calcularAno(linhas, tipo = estadoAnual.tipo) {
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
function _visao(ano) {
    const base = _calcularAno(estadoAnual.porAno[ano]);
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
/** classe bom/ruim conforme o tipo: despesa subir é ruim, receita subir é bom */
function _classeVar(p) {
    if (p === null || Math.abs(p) < 0.5) return '';
    const bom = estadoAnual.tipo === 'entradas' ? p > 0 : p < 0;
    return bom ? 'bom' : 'ruim';
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
function _linhaGrafico(linhasR, linhasD, meses, mesAtual) {
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
    const cels = meses.map(i => `<td class="grafico-cel${i === mesAtual ? ' atual' : ''}"><div class="par">${barra(linhasR, i, 'rec', 'Receita')}${barra(linhasD, i, 'desp', 'Despesa')}</div></td>`).join('');
    return `<tr class="grafico-linha"><th class="anual-nome grafico-rot"><span class="leg"><i class="rec"></i>Receita <i class="desp"></i>Despesa</span></th>${cels}<td class="grafico-cel"></td></tr>`;
}

function _renderComparacaoMeses(v, meses, ref) {
    const c = estadoAnual.cmp;
    if (!c.ativo) return '';
    if (c.a === null) c.a = ref;
    if (c.b === null) c.b = ref > 0 ? ref - 1 : Math.min(11, ref + 1);
    const opcoes = sel => MESES_ANUAL_LONGO.map((m, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${m}</option>`).join('');
    const linhas = v.linhas.map(l => ({ nome: l.nome, a: l.meses[c.a], b: l.meses[c.b] }))
        .filter(l => Math.abs(l.a) > 0.004 || Math.abs(l.b) > 0.004)
        .map(l => ({ ...l, d: l.a - l.b, p: _pct(l.a, l.b) }))
        .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    const tA = linhas.reduce((s, l) => s + l.a, 0), tB = linhas.reduce((s, l) => s + l.b, 0);
    const corpo = linhas.map(l => `<tr><th scope="row" class="anual-nome"><i class="anual-ponto" style="background:${_corDoNomeAnual(l.nome)}"></i><span>${_esc(l.nome)}</span></th>
        <td>${l.a ? _fmtCel(l.a) : '–'}</td><td>${l.b ? _fmtCel(l.b) : '–'}</td>
        <td class="delta ${_classeVar(l.p === null ? (l.d > 0 ? 100 : l.d < 0 ? -100 : 0) : l.p)}">${l.d > 0 ? '+' : ''}${_fmtCel(l.d)}</td>
        <td class="delta ${_classeVar(l.p)}">${_fmtPct(l.p)}</td></tr>`).join('');
    const pT = _pct(tA, tB);
    return `<div class="anual-bloco anual-cmp">
        <div class="anual-cmp-topo">
            <b>Comparar meses</b>
            <select id="anualCmpA" aria-label="Mês A">${opcoes(c.a)}</select>
            <span>com</span>
            <select id="anualCmpB" aria-label="Mês B">${opcoes(c.b)}</select>
            <button type="button" class="anual-toggle" data-anual-cmp-inverter title="Trocar A e B">⇅</button>
        </div>
        ${linhas.length ? `<div class="anual-tabela-wrap"><table class="anual-tabela anual-tabela-cmp">
            <thead><tr><th class="anual-nome">${estadoAnual.agrupar === 'categoria' ? 'Categoria' : 'Forma de pgto.'}</th><th>${MESES_ANUAL[c.a]}</th><th>${MESES_ANUAL[c.b]}</th><th>Diferença</th><th>%</th></tr></thead>
            <tbody>${corpo}</tbody>
            <tfoot><tr class="tot"><th scope="row" class="anual-nome">Total</th><td>${_fmtCel(tA)}</td><td>${_fmtCel(tB)}</td><td class="delta ${_classeVar(pT)}">${tA - tB > 0 ? '+' : ''}${_fmtCel(tA - tB)}</td><td class="delta ${_classeVar(pT)}">${_fmtPct(pT)}</td></tr></tfoot>
        </table></div>` : '<p class="empty-message">Nada lançado nesses meses.</p>'}
    </div>`;
}

function _renderVisaoAnual() {
    const cont = document.getElementById('anualConteudo');
    if (!cont) return;
    const { ano, tipo, agrupar } = estadoAnual;
    const v = _visao(ano);
    const hoje = new Date();
    const mesAtual = hoje.getFullYear() === ano ? hoje.getMonth() : -1;
    const ultimoMes = hoje.getFullYear() === ano ? hoje.getMonth() : (ano < hoje.getFullYear() ? 11 : -1);
    const { linhas, totais } = v;
    // O gráfico mostra receita E despesa (independente do seletor); o filtro vale pros dois
    const dadosAno = estadoAnual.porAno[ano];
    const filtra = ls => (estadoAnual.filtro ? ls.filter(l => l.nome === estadoAnual.filtro) : ls);
    const baseR = _calcularAno(dadosAno, 'entradas').linhas, baseD = _calcularAno(dadosAno, 'saidas').linhas;
    const meses = _mesesVisiveis([baseR, baseD, v.todas], ano);
    const totalAno = totais.reduce((a, b) => a + b, 0);
    const decorridos = ultimoMes + 1;
    const media = decorridos ? totais.slice(0, decorridos).reduce((a, b) => a + b, 0) / decorridos : 0;
    const iMax = totais.reduce((im, x, i) => (x > totais[im] ? i : im), 0);
    const nomeTipo = tipo === 'entradas' ? 'Receitas' : 'Despesas';
    const ref = Math.max(0, ultimoMes >= 0 ? ultimoMes : 0);
    const varMes = ref > 0 ? _pct(totais[ref], totais[ref - 1]) : null;
    const fmtVar = p => (p === null ? '—' : `${p > 0 ? '▲' : p < 0 ? '▼' : ''} ${Math.abs(p).toFixed(0)}%`);

    // Orçamento (só despesa por categoria)
    const usaOrc = tipo === 'saidas' && agrupar === 'categoria';
    const orc = usaOrc ? estadoAnual.orcamentos : {};
    const somaOrc = linhas.reduce((a, l) => a + (orc[l.nome] || 0), 0);
    const gastoNoMesOrc = linhas.filter(l => orc[l.nome]).reduce((a, l) => a + l.meses[ref], 0);

    const maxCel = Math.max(1, ...linhas.flatMap(l => l.meses.map(x => Math.abs(x))));
    const corHeat = tipo === 'entradas' ? 'var(--receita-text)' : 'var(--despesa-text)';
    const linhasHTML = linhas.map(l => {
        const negativa = l.nome.startsWith('(−)');
        const limite = usaOrc && !negativa ? (orc[l.nome] || 0) : 0;
        const cel = meses.map(i => {
            const x = l.meses[i];
            if (Math.abs(x) < 0.005) return `<td class="vazio">–</td>`;
            const forca = Math.round(8 + 42 * Math.min(1, Math.abs(x) / maxCel));
            const estourou = limite && x > limite;
            return `<td class="cel${i === mesAtual ? ' atual' : ''}${estourou ? ' estourou' : ''}" style="background:color-mix(in srgb, ${negativa ? 'var(--receita-text)' : corHeat} ${forca}%, transparent)" title="${_esc(l.nome)} · ${MESES_ANUAL_LONGO[i]}: ${_fmtMoeda(x)}${estourou ? ` — acima do orçamento (${_fmtMoeda(limite)})` : ''}">${_fmtCel(x)}</td>`;
        }).join('');
        const ponto = negativa ? '' : `<i class="anual-ponto" style="background:${_corDoNomeAnual(l.nome)}"></i>`;
        const alvoFiltro = negativa ? '' : ` data-anual-linha="${_esc(l.nome)}" title="Filtrar só ${_esc(l.nome)}"`;
        const colOrc = usaOrc ? (negativa ? '<td></td>' : `<td class="orc"><button type="button" data-anual-orc="${_esc(l.nome)}" title="Definir orçamento mensal de ${_esc(l.nome)}">${limite ? _fmtCel(limite) : '+'}</button></td>`) : '';
        return `<tr><th scope="row" class="anual-nome${negativa ? '' : ' clicavel'}"${alvoFiltro}>${ponto}<span>${_esc(l.nome)}</span></th>${cel}<td class="total">${_fmtCel(l.total)}</td>${colOrc}</tr>`;
    }).join('');

    const deltas = meses.map(i => {
        if (i === 0 || !totais[i - 1] || (ultimoMes >= 0 && i > ultimoMes)) return `<td class="vazio">–</td>`;
        const p = _pct(totais[i], totais[i - 1]);
        return `<td class="delta ${_classeVar(p)}">${_fmtPct(p)}</td>`;
    }).join('');
    const cabExtra = usaOrc ? '<th class="total" title="Orçamento mensal por categoria">Orçam.</th>' : '';
    const rodTot = usaOrc ? `<td class="orc">${somaOrc ? _fmtCel(somaOrc) : ''}</td>` : '';
    const rodVar = usaOrc ? '<td></td>' : '';

    const opcoes = v.todas.filter(l => !l.nome.startsWith('(−)')).map(l => `<option value="${_esc(l.nome)}"${l.nome === estadoAnual.filtro ? ' selected' : ''}>${_esc(l.nome)}</option>`).join('');
    const rotuloTodas = agrupar === 'categoria' ? 'Todas as categorias' : 'Todas as formas';

    cont.innerHTML = `
        <div class="anual-filtros">
            <select id="anualFiltro" aria-label="Filtrar"><option value="">${rotuloTodas}</option>${opcoes}</select>
            <button type="button" class="anual-toggle${estadoAnual.cmp.ativo ? ' active' : ''}" data-anual-cmp title="Comparar dois meses">⇄ Comparar meses</button>
        </div>
        <div class="anual-cards">
            <div class="anual-card"><span>${nomeTipo} no ano</span><b>${_fmtMoeda(totalAno)}</b></div>
            <div class="anual-card"><span>Média por mês</span><b>${_fmtMoeda(media)}</b></div>
            <div class="anual-card"><span>Maior mês</span><b>${totalAno ? `${MESES_ANUAL_LONGO[iMax]} · ${_fmtMoeda(totais[iMax])}` : '—'}</b></div>
            <div class="anual-card"><span>${MESES_ANUAL[ref]} vs. mês anterior</span><b class="${_classeVar(varMes)}">${fmtVar(varMes)}</b></div>
            ${somaOrc ? `<div class="anual-card"><span>Orçamento de ${MESES_ANUAL[ref]}</span><b class="${gastoNoMesOrc > somaOrc ? 'ruim' : 'bom'}">${_fmtMoeda(gastoNoMesOrc)} de ${_fmtMoeda(somaOrc)}</b></div>` : ''}
        </div>
        ${_renderComparacaoMeses(v, meses, ref)}
        ${linhas.length ? `
        <div class="anual-tabela-wrap anual-bloco">
            <table class="anual-tabela">
                <thead>
                    ${_linhaGrafico(filtra(baseR), filtra(baseD), meses, mesAtual)}
                    <tr><th class="anual-nome">${agrupar === 'categoria' ? 'Categoria' : 'Forma de pgto.'}</th>
                    ${meses.map(i => `<th class="mes${i === mesAtual ? ' atual' : ''}"><button type="button" data-ir-mes="${i}" title="Ir para ${MESES_ANUAL_LONGO[i]}">${MESES_ANUAL[i]}</button></th>`).join('')}
                    <th class="total">Total</th>${cabExtra}</tr>
                </thead>
                <tbody>${linhasHTML}</tbody>
                <tfoot>
                    <tr class="tot"><th scope="row" class="anual-nome">Total</th>${meses.map(i => `<td class="${i === mesAtual ? 'atual' : ''}">${totais[i] ? _fmtCel(totais[i]) : '–'}</td>`).join('')}<td class="total">${_fmtCel(totalAno)}</td>${rodTot}</tr>
                    <tr class="var"><th scope="row" class="anual-nome">vs. mês anterior</th>${deltas}<td></td>${rodVar}</tr>
                </tfoot>
            </table>
        </div>
        <p class="menu-hint anual-nota">Valores em R$ (sem centavos), pelo mês da competência${v.temEstorno ? '; estornos/reembolsos no cartão abatem a despesa' : ''}. No gráfico, a barra da esquerda é a receita e a da direita a despesa do mês, coloridas pela proporção de cada ${agrupar === 'categoria' ? 'categoria' : 'forma de pagamento'}. Meses passados sem lançamento não aparecem. Toque num mês para abri-lo${usaOrc ? ', no nome de uma categoria para filtrá-la e em “Orçam.” para definir o limite mensal (célula acima do limite fica com borda vermelha)' : ''}.</p>`
        : `<p class="empty-message">Nada lançado em ${ano}${estadoAnual.filtro ? ` para “${_esc(estadoAnual.filtro)}”` : ''}.</p>`}`;
}

/** Abre a página, carrega o ano e desenha. */
async function carregarVisaoAnual(forcar = false) {
    const cont = document.getElementById('anualConteudo');
    if (!cont || estadoAnual.carregando) return;
    document.getElementById('anualAno').textContent = estadoAnual.ano;
    document.querySelectorAll('#anual [data-anual-tipo]').forEach(b => b.classList.toggle('active', b.dataset.anualTipo === estadoAnual.tipo));
    document.querySelectorAll('#anual [data-anual-agrupar]').forEach(b => b.classList.toggle('active', b.dataset.anualAgrupar === estadoAnual.agrupar));
    if (forcar || !estadoAnual.porAno[estadoAnual.ano]) {
        estadoAnual.carregando = true;
        cont.innerHTML = '<p class="loading">Carregando...</p>';
        try {
            estadoAnual.porAno[estadoAnual.ano] = await _buscarTransacoesDoAno(estadoAnual.ano);
            if (forcar) await _carregarOrcamentos();
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

/** Diálogo do orçamento mensal de uma categoria. */
function _editarOrcamento(categoria) {
    const atual = estadoAnual.orcamentos[categoria];
    mostrarDialogo({
        titulo: `Orçamento mensal — ${_esc(categoria)}`,
        corpoHTML: `<div class="campo"><label for="dlgOrcValor">Limite por mês (R$)</label>
            <input type="text" id="dlgOrcValor" inputmode="decimal" placeholder="Ex: 800,00" value="${atual ? String(atual).replace('.', ',') : ''}" autocomplete="off"></div>
            <p class="menu-hint">Vale para todos os meses. Os meses acima do limite ficam com borda vermelha.</p>`,
        acoes: [
            { label: 'Cancelar' },
            ...(atual ? [{ label: 'Remover', perigo: true, onClick: async () => {
                const { error } = await sb.from('orcamentos').delete().eq('categoria', categoria);
                if (error) { mostrarNotificacao('Erro ao remover o orçamento', 'erro'); return true; }
                delete estadoAnual.orcamentos[categoria];
                _renderVisaoAnual();
            } }] : []),
            { label: 'Salvar', primario: true, onClick: async (ov) => {
                const v = parseFloat(String(ov.querySelector('#dlgOrcValor').value).replace(/\./g, '').replace(',', '.'));
                if (!(v > 0)) { mostrarNotificacao('Informe um valor maior que zero', 'info'); return true; }
                const { error } = await sb.from('orcamentos').upsert({ categoria, valor: v }, { onConflict: 'user_id,categoria' });
                if (error) { console.error(error); mostrarNotificacao('Erro ao salvar o orçamento', 'erro'); return true; }
                estadoAnual.orcamentos[categoria] = v;
                _renderVisaoAnual();
            } },
        ],
    });
}

function iniciarVisaoAnual() {
    const aba = document.getElementById('anual');
    if (!aba) return;
    aba.addEventListener('click', async e => {
        const btnTipo = e.target.closest('[data-anual-tipo]');
        const btnAgr = e.target.closest('[data-anual-agrupar]');
        const btnAno = e.target.closest('[data-anual-ano]');
        const btnMes = e.target.closest('[data-ir-mes]');
        const btnOrc = e.target.closest('[data-anual-orc]');
        const linha = e.target.closest('[data-anual-linha]');
        if (btnTipo) { estadoAnual.tipo = btnTipo.dataset.anualTipo; estadoAnual.filtro = ''; carregarVisaoAnual(); }
        else if (btnAgr) { estadoAnual.agrupar = btnAgr.dataset.anualAgrupar; estadoAnual.filtro = ''; carregarVisaoAnual(); }
        else if (btnAno) { estadoAnual.ano += Number(btnAno.dataset.anualAno); estadoAnual.filtro = ''; estadoAnual.cmp.a = estadoAnual.cmp.b = null; carregarVisaoAnual(); }
        else if (e.target.closest('[data-anual-cmp]')) { estadoAnual.cmp.ativo = !estadoAnual.cmp.ativo; _renderVisaoAnual(); }
        else if (e.target.closest('[data-anual-cmp-inverter]')) { const c = estadoAnual.cmp; [c.a, c.b] = [c.b, c.a]; _renderVisaoAnual(); }
        else if (btnOrc) { _editarOrcamento(btnOrc.dataset.anualOrc); }
        else if (linha) { estadoAnual.filtro = estadoAnual.filtro === linha.dataset.anualLinha ? '' : linha.dataset.anualLinha; _renderVisaoAnual(); }
        else if (btnMes) {
            // Leva o app pro mês tocado e volta ao normal
            estadoApp.mesAtual = new Date(estadoAnual.ano, Number(btnMes.dataset.irMes), 1);
            if (typeof fecharAbas === 'function') fecharAbas();
            if (typeof recarregarDados === 'function') await recarregarDados();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
    aba.addEventListener('change', e => {
        if (e.target.id === 'anualFiltro') { estadoAnual.filtro = e.target.value; _renderVisaoAnual(); }
        else if (e.target.id === 'anualCmpA') { estadoAnual.cmp.a = Number(e.target.value); _renderVisaoAnual(); }
        else if (e.target.id === 'anualCmpB') { estadoAnual.cmp.b = Number(e.target.value); _renderVisaoAnual(); }
    });
}
