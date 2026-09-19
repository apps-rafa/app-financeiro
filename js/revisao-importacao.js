/**
 * REVISÃO DE IMPORTAÇÃO — peças de HTML compartilhadas pelas telas que
 * revisam lançamentos antes de virarem lançamento de verdade: CSV
 * (importar-csv.js), Open Finance (pluggy.js) e PDF/conciliar
 * (conciliar-pdf.js). Existe pra as 3 terem exatamente o mesmo layout:
 *
 *   grupo (details)  →  subgrupo Despesas / Receitas (details)  →  tabela
 *   colunas: [X] Data · Valor · (específicas da tela) · Descrição (editável)
 *
 * Cada tela decide QUEM entra em cada grupo, o que as linhas guardam e o que
 * acontece no X / na edição; aqui só o HTML.
 */

/** "dd/mm" — a revisão nunca mostra o ano. */
function dataCurtaRevisao(dataISO) {
    if (!dataISO) return '?';
    const [, m, d] = String(dataISO).slice(0, 10).split('-');
    return `${d}/${m}`;
}

function escAttrRevisao(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Botão "X" (vira "↺" quando a linha já está marcada). Só marca — a tela
 *  decide se a linha some (nunca some sozinha: fica esmaecida e travada). */
function htmlBotaoXRevisao(chave, ignorada) {
    const titulo = ignorada ? 'Reativar esta linha' : 'Não importar esta linha';
    return `<button type="button" class="import-x" data-rev-x="${escAttrRevisao(chave)}" title="${titulo}" aria-label="${titulo}">${ignorada ? '↺' : '✕'}</button>`;
}

/**
 * Linha da tabela.
 *   atributos     atributos extras do <tr> (ex.: data-importada-id="12")
 *   ignorada      esmaece a linha (o X foi marcado)
 *   revisar       destaca em vermelho (falta resolver algo) — some ao ajustar
 *   chaveX        chave do botão X (omitida = sem X); celulaAcao substitui o X
 *   dataISO/valor
 *   celulasMeio   <td>…</td> específicos da tela (forma de pgto., categoria…)
 *   descricao     texto; com `editavel` vira <input> (name/attrs via attrsDesc)
 */
function htmlLinhaRevisao(o) {
    const classes = o.ignorada ? 'linha-ignorada' : (o.revisar ? 'import-csv-linha-revisar' : '');
    const acao = o.celulaAcao !== undefined
        ? o.celulaAcao
        : (o.chaveX !== undefined && o.chaveX !== null ? htmlBotaoXRevisao(o.chaveX, !!o.ignorada) : '');
    const desc = o.editavel
        ? `<td class="import-csv-desc-edit"><input type="text" class="import-desc-input" data-campo="descricao" ${o.attrsDesc || ''}
              name="descricao" aria-label="Descrição" value="${escAttrRevisao(o.descricao)}" placeholder="${escAttrRevisao(o.placeholderDesc || '')}"
              title="Descrição (editável)" ${o.ignorada ? 'disabled' : ''}></td>`
        : `<td class="import-csv-desc" title="${escAttrRevisao(o.descricao)}">${escAttrRevisao(o.descricao)}</td>`;
    return `
    <tr ${o.atributos || ''}${classes ? ` class="${classes}"` : ''}>
        <td>${acao}</td>
        <td>${dataCurtaRevisao(o.dataISO)}</td>
        <td>${formatarMoeda(o.valor)}</td>
        ${o.celulasMeio || ''}
        ${desc}
    </tr>`;
}

/**
 * Subgrupos Despesas / Receitas (cada um é um <details> igual ao grupo pai —
 * mesma classe, mesma seta — com a própria tabela). `abertos` guarda o estado
 * pelo id completo; começam abertos.
 *   colunas   títulos das colunas DEPOIS da primeira (a do X/ação, sem título)
 */
function htmlSubgruposRevisao({ idPai, abertos, itens, tipoDe, colunas, htmlLinha }) {
    const cab = `<thead><tr><th></th>${colunas.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
    const sub = (tipo, lista) => !lista.length ? '' : _grupoColapsavelConciliar({
        id: `${idPai}-${tipo}`, abertos, padraoAberto: true,
        titulo: `${tipo === 'entradas' ? 'Receitas' : 'Despesas'} (${lista.length})`,
        corpo: `
    <div class="import-csv-tabela-wrap import-csv-tabela-wrap--solta">
        <table class="import-csv-tabela import-csv-tabela--compacta">
            ${cab}
            <tbody>${lista.map(htmlLinha).join('')}</tbody>
        </table>
    </div>`
    });
    return sub('saidas', itens.filter(i => tipoDe(i) !== 'entradas'))
         + sub('entradas', itens.filter(i => tipoDe(i) === 'entradas'));
}

/** Grupo pai (details) com os subgrupos Despesas/Receitas dentro. */
function htmlGrupoRevisao({ id, titulo, abertos, padraoAberto, itens, tipoDe, colunas, htmlLinha, nota = '' }) {
    if (!itens.length) return '';
    return _grupoColapsavelConciliar({
        id, abertos, padraoAberto, titulo: `${titulo} (${itens.length})`,
        corpo: nota + htmlSubgruposRevisao({ idPai: id, abertos, itens, tipoDe, colunas, htmlLinha })
    });
}
