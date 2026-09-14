/**
 * IMPORTAR CSV
 * Importação em lote de lançamentos a partir de um arquivo CSV (ex.:
 * export de uma planilha de controle externo). Sempre Pontual — cada
 * linha vira uma transação avulsa.
 */

// Estado da importação em andamento (module-local, refeito a cada arquivo escolhido)
let estadoImportCSV = null;

/** Liga os listeners da sub-aba "Importar CSV" (chamada por carregarAbaMenus). */
function iniciarImportarCSV() {
    const sec = document.getElementById('secImportarCSV');
    if (!sec) return;
    estadoImportCSV = null;
    renderImportCSV();
}

/* ---------- Parser CSV (sem biblioteca externa) ---------- */

/** Parseia um texto CSV completo em linhas de campos, respeitando aspas
 *  (campo entre aspas pode conter vírgula literal e "" vira uma aspas). */
function _parsearCSV(texto) {
    const linhas = [];
    let campo = '', linha = [], dentroAspas = false;
    const s = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (dentroAspas) {
            if (c === '"') {
                if (s[i + 1] === '"') { campo += '"'; i++; }
                else dentroAspas = false;
            } else {
                campo += c;
            }
        } else if (c === '"') {
            dentroAspas = true;
        } else if (c === ',') {
            linha.push(campo); campo = '';
        } else if (c === '\n') {
            linha.push(campo); campo = '';
            linhas.push(linha); linha = [];
        } else {
            campo += c;
        }
    }
    if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas.filter(l => l.length && l.some(c => String(c).trim() !== ''));
}

/** "13,90" / "-17,20" / "- 1.941,66" (Nubank põe espaço depois do sinal) -> 13.9 / -17.2 / -1941.66 */
function _parsearValorBR(s) {
    const limpo = String(s || '').trim().replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
    const v = parseFloat(limpo);
    return Number.isFinite(v) ? v : null;
}

/** Normaliza pra comparação tolerante: minúsculas, sem acento, só alfanumérico. */
function _normalizarChave(s) {
    return String(s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** true se uma string "contém" a outra depois de normalizada (resolve
 *  "Pix" -> "PIX/Débito" e "Assinatura" -> "Assinaturas" sem exigir igualdade). */
function _bateAproximado(a, b) {
    const na = _normalizarChave(a), nb = _normalizarChave(b);
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
}

/* ---------- Reconstrução de data a partir do dia + corte + competência ---------- */

/** dia (1-31) + competência (yyyy-mm-01) + corte -> data ISO real.
 *  dia >= corte cai no mês ANTERIOR à competência; dia < corte fica no
 *  próprio mês de competência. */
function _reconstruirDataISO(dia, competenciaISO, corte) {
    const m = String(competenciaISO || '').match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (!m || !Number.isInteger(dia)) return null;
    let ano = parseInt(m[1], 10), mes = parseInt(m[2], 10);
    if (corte != null && dia >= corte) {
        mes -= 1;
        if (mes < 1) { mes = 12; ano -= 1; }
    }
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Tenta ler a coluna Data como uma DATA COMPLETA (com mês/ano) — aceita
 *  "dd/mm/aaaa", "dd/mm/aa", "dd-mm-aaaa" ou "aaaa-mm-dd". Retorna null se
 *  não bater com nenhum desses formatos, e quem chamou trata como "só o
 *  dia" (reconstrução via corte — ver _reconstruirDataISO acima). Existe
 *  porque "só o dia" depende do usuário lembrar de preencher certo o "Dia
 *  de corte"; esquecer isso silenciosamente jogava tudo pro mês de
 *  competência escolhido, sem nunca rolar pro mês anterior. Com data
 *  completa não tem corte nenhum pra esquecer. */
function _parsearDataCompleta(s) {
    const str = String(s || '').trim();
    let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
    if (m) {
        const dia = parseInt(m[1], 10), mes = parseInt(m[2], 10);
        const ano = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
        if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
        return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }
    return null;
}

/* ---------- Parse do arquivo escolhido -> linhas estruturadas ---------- */

function _parsearArquivoImport(texto) {
    const linhasCSV = _parsearCSV(texto);
    if (!linhasCSV.length) return [];

    // Detecta e descarta cabeçalho (1ª linha sem valor numérico/data na col. 1)
    let inicio = 0;
    if (linhasCSV[0] && isNaN(parseInt(linhasCSV[0][0], 10)) && !_parsearDataCompleta(linhasCSV[0][0])) inicio = 1;

    const linhas = [];
    for (let i = inicio; i < linhasCSV.length; i++) {
        const [dataCru, valorCru, metodoCru, tagCru, descCru] = linhasCSV[i];
        const dataCompletaISO = _parsearDataCompleta(dataCru);
        const dia = dataCompletaISO ? null : parseInt(String(dataCru || '').trim(), 10);
        const valor = _parsearValorBR(valorCru);
        // Linha só com o dia (sobra de calendário na planilha do usuário): ignora
        if ((!dataCompletaISO && !Number.isInteger(dia)) || valor == null) continue;

        linhas.push({
            linhaOriginal: i + 1,
            dia,
            dataCompletaISO,
            valorBruto: valor,
            metodoCSV: String(metodoCru || '').trim(),
            categoriaCSV: String(tagCru || '').trim(),
            descricao: String(descCru || '').trim()
        });
    }
    return linhas;
}

/* ---------- Matching contra métodos/categorias já cadastrados ---------- */

/** Entre os candidatos que "batem" (ver _bateAproximado), prefere sempre a
 *  igualdade exata (normalizada) — senão "Transporte app" no CSV podia
 *  casar com "Transporte" só por "Transporte" ser um prefixo/substring e
 *  aparecer antes na lista. Só cai pra substring quando não há exata. */
function _melhorMatch(alvo, candidatos, chaveDe) {
    const na = _normalizarChave(alvo);
    if (!na) return null;
    const exato = candidatos.find(c => _normalizarChave(chaveDe(c)) === na);
    if (exato) return exato;
    return candidatos.find(c => _bateAproximado(alvo, chaveDe(c))) || null;
}

function _resolverMetodo(metodoCSV) {
    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const achado = _melhorMatch(metodoCSV, metodos, m => rotuloMetodo(m));
    return achado ? rotuloMetodo(achado) : null;
}

function _resolverCategoria(categoriaCSV, tipo) {
    const lista = tipo === 'entradas'
        ? (estadoApp.menus.categoriasReceita || [])
        : (estadoApp.menus.categoriasDespesa || []);
    return _melhorMatch(categoriaCSV, lista, c => c);
}

/** Recalcula tipo/data/matches de todas as linhas a partir do contexto atual (competência+corte). */
function _recalcularLinhas() {
    const st = estadoImportCSV;
    if (!st) return;
    st.linhas.forEach(l => {
        l.tipo = l.valorBruto < 0 ? 'entradas' : 'saidas';
        l.valor = Math.abs(l.valorBruto);
        l.dataISO = l.dataCompletaISO || _reconstruirDataISO(l.dia, st.competenciaISO, st.corte);
        if (l.metodoResolvido === undefined) l.metodoResolvido = _resolverMetodo(l.metodoCSV);
        if (l.categoriaResolvida === undefined) {
            // Linhas de receita (valor negativo no CSV) sempre começam sem
            // categoria — não dá pra advinhar entre Devolução/Reembolso/Racha.
            l.categoriaResolvida = l.tipo === 'entradas' ? null : _resolverCategoria(l.categoriaCSV, l.tipo);
        }
    });
}

function _linhaPronta(l) {
    if (l.ignorarManual) return false;                 // usuário marcou pra não importar
    if (l.duplicataExata) return false;               // já existe idêntica — ignorada sem perguntar
    if (l.duplicataSuspeita && l.pularDuplicata) return false; // parecida — usuário decide (marcado por padrão)
    // Competência é sempre gravada na transação (mesmo com data completa,
    // que não depende dela pra calcular o dia) — sem competência, nada fica pronto.
    return !!l.dataISO && !!estadoImportCSV?.competenciaISO
        && !!l.metodoResolvido && !!l.categoriaResolvida && l.valor > 0;
}

/* ---------- Detecção de duplicatas contra o que já está no app ---------- */

/** Busca no Supabase as transações que caem perto da janela de datas do
 *  arquivo (guardada em cache pra não refazer a query a cada troca de
 *  método/categoria — só refeita quando a data das linhas muda de verdade,
 *  ver _recomputarImportCSV). Alarga a janela ±35 dias: reimportações
 *  anteriores (de antes do dia de corte ter virado obrigatório/data
 *  completa) podem ter gravado a mesma compra até um mês fora do lugar —
 *  descrição+valor+método batendo é sinal forte o bastante mesmo com a
 *  data bem longe (ver _aplicarStatusDuplicata). */
async function _buscarExistentesParaDuplicata(linhas) {
    const datas = linhas.map(l => l.dataISO).filter(Boolean).sort();
    if (!datas.length) return [];
    const PAD_DIAS = 35 * 86400000;
    const paraISO = ms => new Date(ms).toISOString().slice(0, 10);
    const ini = paraISO(new Date(datas[0] + 'T00:00:00').getTime() - PAD_DIAS);
    const fim = paraISO(new Date(datas[datas.length - 1] + 'T00:00:00').getTime() + PAD_DIAS);
    const { data, error } = await sb.from('transacoes').select('tipo,data,valor,metodo,categoria,descricao')
        .gte('data', ini).lte('data', fim);
    if (error) { console.error('Erro ao checar duplicatas:', error); return []; }
    return data || [];
}

/** Marca cada linha como duplicata EXATA (mesmo dia, valor, forma de
 *  pagamento e descrição — ignorada sem perguntar) ou SUSPEITA:
 *  - mesmo dia + valor + forma de pagamento, descrição diferente; OU
 *  - mesma descrição + valor + forma de pagamento, dia diferente (pega
 *    duplicata de uma reimportação anterior que gravou a mesma compra num
 *    dia errado — mesmo se for um mês inteiro fora do lugar).
 *  Usuário decide via checkbox, marcado por padrão pra pular. Categoria
 *  fica de fora do critério de propósito: receita (tipo 'entradas') nunca
 *  vem com categoria pré-resolvida (não dá pra advinhar — ver
 *  _recalcularLinhas), então exigir categoria bateria só por acaso. Não
 *  mexe em `pularDuplicata` se a linha já tinha uma escolha manual, pra
 *  não perder o que o usuário já decidiu ao reavaliar. */
function _aplicarStatusDuplicata(linhas, existentes) {
    linhas.forEach(l => {
        l.duplicataExata = false;
        l.duplicataSuspeita = false;
        if (!l.dataISO) return;

        const metodoL = l.metodoResolvido || '';
        const descL = _normalizarChave(l.descricao);
        const mesmoValorMetodoTipo = t => t.tipo === l.tipo
            && Math.abs(parseFloat(t.valor) - l.valor) < 0.005
            && (t.metodo || '') === metodoL;

        const candidatos = existentes.filter(mesmoValorMetodoTipo);

        if (candidatos.some(t => t.data === l.dataISO && _normalizarChave(t.descricao) === descL)) {
            l.duplicataExata = true;
            return;
        }
        const suspeita = candidatos.some(t => t.data === l.dataISO || _normalizarChave(t.descricao) === descL);
        if (suspeita) {
            l.duplicataSuspeita = true;
            if (l.pularDuplicata === undefined) l.pularDuplicata = true;
        }
    });
}

/* ---------- Render ---------- */

function renderImportCSV() {
    const sec = document.getElementById('secImportarCSV');
    if (!sec) return;
    const st = estadoImportCSV;

    if (!st) {
        sec.innerHTML = `
        <p class="menu-hint">
            Importa vários lançamentos Pontuais de uma vez a partir de um CSV com as colunas
            <b>Data, Valor, Método, Tag, Descrição</b>. A coluna Data aceita data completa
            (dd/mm/aaaa) ou só o dia (sem mês/ano) — o dia sozinho é útil pra colar o ciclo de
            fatura de um cartão, mas exige preencher certo o "Dia de corte" pra rolar pro mês
            anterior quando precisar; data completa não tem essa pegadinha.
        </p>
        <div class="import-csv-upload">
            <input type="file" id="importCsvArquivo" accept=".csv,text/csv">
        </div>`;
        const inp = document.getElementById('importCsvArquivo');
        if (inp) inp.addEventListener('change', onImportCsvArquivoEscolhido);
        return;
    }

    const linhasComIdx = st.linhas.map((l, i) => [l, i]);
    const exatas = linhasComIdx.filter(([l]) => l.duplicataExata);
    const suspeitas = linhasComIdx.filter(([l]) => l.duplicataSuspeita);
    const normais = linhasComIdx.filter(([l]) => !l.duplicataExata && !l.duplicataSuspeita);
    // Ignorada manualmente conta como resolvida (não bloqueia a importação,
    // não entra em "para revisar"), mas nunca é "pronta" — fica na mesma
    // tabela de revisão, só com a caixinha já marcada.
    const paraRevisarOuIgnorada = normais.filter(([l]) => l.ignorarManual || !_linhaPronta(l));
    const prontasLinhas = normais.filter(([l]) => !l.ignorarManual && _linhaPronta(l));
    const prontas = st.linhas.filter(_linhaPronta).length;
    const revisar = paraRevisarOuIgnorada.filter(([l]) => !l.ignorarManual).length;

    const tabela = (titulo, grupo, comCheckboxIgnorar = false) => !grupo.length ? '' : `
    <div class="import-csv-grupo-titulo">${titulo} (${grupo.length})</div>
    <div class="import-csv-tabela-wrap">
        <table class="import-csv-tabela">
            <thead><tr>
                ${comCheckboxIgnorar ? '<th>Ignorar?</th>' : ''}
                <th>Data</th><th>Valor</th><th>Tipo</th><th>Forma de pgto.</th><th>Categoria</th><th>Descrição</th>
            </tr></thead>
            <tbody>${grupo.map(([l, i]) => _renderLinhaImportCSV(l, i, false, comCheckboxIgnorar)).join('')}</tbody>
        </table>
    </div>`;

    const tabelaSuspeitas = !suspeitas.length ? '' : `
    <div class="import-csv-grupo-titulo">🔁 Possíveis duplicatas — já existe algo parecido no app (${suspeitas.length})</div>
    <p class="import-csv-nota">Mesmo tipo, data e valor de algo já lançado, mas com forma de pagamento/categoria/descrição diferente. Marcadas pra pular por padrão — desmarque se for mesmo um lançamento novo.</p>
    <div class="import-csv-tabela-wrap">
        <table class="import-csv-tabela">
            <thead><tr>
                <th>Pular?</th><th>Data</th><th>Valor</th><th>Tipo</th><th>Forma de pgto.</th><th>Categoria</th><th>Descrição</th>
            </tr></thead>
            <tbody>${suspeitas.map(([l, i]) => _renderLinhaImportCSV(l, i, true)).join('')}</tbody>
        </table>
    </div>`;

    const infoExatas = !exatas.length ? '' : `
    <p class="import-csv-nota">🔁 ${exatas.length} linha${exatas.length === 1 ? '' : 's'} idêntica${exatas.length === 1 ? '' : 's'} a algo já lançado (mesmo tipo, data, valor, método e descrição) — ignorada${exatas.length === 1 ? '' : 's'} automaticamente, sem entrar na importação.</p>`;

    const faltaCompetencia = !st.competenciaISO;
    const faltamData = paraRevisarOuIgnorada.some(([l]) => !l.ignorarManual && !l.dataISO);
    // Se toda linha já veio com data completa (dd/mm/aaaa etc.), o corte não
    // serve pra nada — não tem "dia do mês" pra reconstruir.
    const todasComDataCompleta = st.linhas.length > 0 && st.linhas.every(l => l.dataCompletaISO);
    const faltamMetodoOuCategoria = paraRevisarOuIgnorada.some(([l]) => !l.ignorarManual && (!l.metodoResolvido || !l.categoriaResolvida));
    const motivos = [];
    if (faltaCompetencia) motivos.push('informe o mês de competência acima');
    else if (faltamData) motivos.push('data');
    if (faltamMetodoOuCategoria) motivos.push('método/categoria');
    const msgBloqueio = motivos.length ? `Resolva ${motivos.join(' e ')} das linhas destacadas pra liberar a importação.` : '';

    sec.innerHTML = `
    <div class="import-csv-contexto">
        <label>Mês de competência
            <span class="import-csv-mes-ano">
                <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" id="importCsvCompetenciaMes"
                       placeholder="mês" value="${st.competenciaMes ?? ''}">
                <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" id="importCsvCompetenciaAno"
                       placeholder="ano" value="${st.competenciaAno ?? ''}">
            </span>
        </label>
        <label ${todasComDataCompleta ? 'hidden' : ''}>
            <span class="import-csv-label-linha">Dia de corte <span class="import-csv-ajuda" title="Dias a partir deste valor caem no mês ANTERIOR à competência (ex.: fechamento do cartão). Deixe em branco se a coluna Data já for do próprio mês de competência.">?</span></span>
            <input type="number" id="importCsvCorte" min="1" max="31" value="${st.corte ?? ''}" placeholder="ex: 14">
        </label>
        <button type="button" class="mini-btn" id="importCsvTrocarArquivo">Trocar arquivo</button>
    </div>
    ${todasComDataCompleta ? `<p class="import-csv-nota">📅 Data completa detectada na planilha — não precisa de "Dia de corte".</p>` : ''}
    ${faltaCompetencia ? `<p class="import-csv-aviso">⚠️ Informe o mês de competência${todasComDataCompleta ? '' : ' pra calcular as datas'} — sem isso nenhuma linha fica pronta.</p>` : ''}
    <p class="import-csv-resumo">
        <b>${st.linhas.length}</b> linhas no arquivo — <span class="ok">${prontas} prontas</span>
        ${revisar ? ` · <span class="alerta">${revisar} para revisar</span>` : ''}
        ${exatas.length ? ` · <span class="alerta">${exatas.length} duplicada${exatas.length === 1 ? '' : 's'}</span>` : ''}
        ${suspeitas.length ? ` · <span class="alerta">${suspeitas.length} possível${suspeitas.length === 1 ? '' : 'is'} duplicata${suspeitas.length === 1 ? '' : 's'}</span>` : ''}
    </p>
    ${infoExatas}
    ${tabela('⚠️ Para revisar', paraRevisarOuIgnorada, true)}
    ${tabelaSuspeitas}
    ${tabela('✓ Prontas', prontasLinhas)}
    <div class="import-csv-acoes">
        <button type="button" class="btn-submit" id="importCsvConfirmar" ${revisar ? 'disabled' : ''}>
            Importar ${prontas} lançamento${prontas === 1 ? '' : 's'}
        </button>
        <button type="button" class="mini-btn" id="importCsvCancelar">Cancelar</button>
        ${msgBloqueio ? `<span class="import-csv-bloqueado">${msgBloqueio}</span>` : ''}
    </div>
    <div id="importCsvProgresso" class="import-csv-progresso" hidden></div>
    `;

    const atualizarCompetenciaDeCampos = () => {
        const mes = parseInt(document.getElementById('importCsvCompetenciaMes')?.value, 10);
        const ano = parseInt(document.getElementById('importCsvCompetenciaAno')?.value, 10);
        st.competenciaMes = Number.isInteger(mes) ? mes : null;
        st.competenciaAno = Number.isInteger(ano) ? ano : null;
        st.competenciaISO = (st.competenciaMes >= 1 && st.competenciaMes <= 12 && st.competenciaAno)
            ? `${st.competenciaAno}-${String(st.competenciaMes).padStart(2, '0')}-01` : null;
        _recomputarImportCSV({ forcarData: true, refazerDuplicatas: true });
    };
    const soDigitos = e => { e.target.value = e.target.value.replace(/\D/g, ''); };
    document.getElementById('importCsvCompetenciaMes')?.addEventListener('input', soDigitos);
    document.getElementById('importCsvCompetenciaAno')?.addEventListener('input', soDigitos);
    document.getElementById('importCsvCompetenciaMes')?.addEventListener('change', atualizarCompetenciaDeCampos);
    document.getElementById('importCsvCompetenciaAno')?.addEventListener('change', atualizarCompetenciaDeCampos);
    document.getElementById('importCsvCorte')?.addEventListener('change', e => {
        const v = parseInt(e.target.value, 10);
        st.corte = Number.isInteger(v) ? v : null;
        _recomputarImportCSV({ forcarData: true, refazerDuplicatas: true });
    });
    document.getElementById('importCsvTrocarArquivo')?.addEventListener('click', () => {
        estadoImportCSV = null;
        renderImportCSV();
    });
    document.getElementById('importCsvCancelar')?.addEventListener('click', () => {
        estadoImportCSV = null;
        renderImportCSV();
    });
    document.getElementById('importCsvConfirmar')?.addEventListener('click', onImportCsvConfirmar);

    // Troca de método/categoria refaz a tabela inteira (linha pode "mudar de
    // grupo" entre revisar/pronta) — sem preservar o scroll, o navegador
    // volta pro topo da página a cada seleção (o <select> em foco some do
    // DOM junto com o innerHTML antigo).
    sec.querySelectorAll('[data-import-metodo]').forEach(sel => {
        sel.addEventListener('change', e => {
            const i = parseInt(e.target.dataset.importMetodo, 10);
            st.linhas[i].metodoResolvido = e.target.value || null;
            _aplicarStatusDuplicata(st.linhas, st._existentes || []);
            _renderImportCSVPreservandoScroll();
        });
    });
    sec.querySelectorAll('[data-import-categoria]').forEach(sel => {
        sel.addEventListener('change', e => {
            const i = parseInt(e.target.dataset.importCategoria, 10);
            const v = e.target.value;
            st.linhas[i].categoriaResolvida = v === '__nova__' ? { criar: true, nome: st.linhas[i].categoriaCSV } : (v || null);
            _aplicarStatusDuplicata(st.linhas, st._existentes || []);
            _renderImportCSVPreservandoScroll();
        });
    });
    sec.querySelectorAll('[data-import-pular-dup]').forEach(chk => {
        chk.addEventListener('change', e => {
            const i = parseInt(e.target.dataset.importPularDup, 10);
            st.linhas[i].pularDuplicata = e.target.checked;
            _renderImportCSVPreservandoScroll();
        });
    });
    sec.querySelectorAll('[data-import-ignorar]').forEach(chk => {
        chk.addEventListener('change', e => {
            const i = parseInt(e.target.dataset.importIgnorar, 10);
            st.linhas[i].ignorarManual = e.target.checked;
            _renderImportCSVPreservandoScroll();
        });
    });
}

/** Recalcula data/tipo/valor (e método/categoria na 1ª vez) e, quando a
 *  janela de datas pode ter mudado (arquivo novo, competência ou corte
 *  editados), busca de novo no Supabase o que já existe pra checar
 *  duplicata — senão só reaplica o status usando o cache já buscado. */
async function _recomputarImportCSV({ forcarData = false, refazerDuplicatas = false } = {}) {
    const st = estadoImportCSV;
    if (!st) return;
    if (forcarData) _recalcularLinhasForcandoData(); else _recalcularLinhas();
    renderImportCSV();

    if (refazerDuplicatas || !st._existentes) {
        st._existentes = await _buscarExistentesParaDuplicata(st.linhas);
    }
    _aplicarStatusDuplicata(st.linhas, st._existentes);
    renderImportCSV();
}

function _renderImportCSVPreservandoScroll() {
    const y = window.scrollY;
    renderImportCSV();
    window.scrollTo(0, y);
}

/** Só recalcula data/tipo/valor (mantém escolhas manuais já feitas de método/categoria). */
function _recalcularLinhasForcandoData() {
    const st = estadoImportCSV;
    if (!st) return;
    st.linhas.forEach(l => {
        l.tipo = l.valorBruto < 0 ? 'entradas' : 'saidas';
        l.valor = Math.abs(l.valorBruto);
        l.dataISO = l.dataCompletaISO || _reconstruirDataISO(l.dia, st.competenciaISO, st.corte);
    });
}

function _rotuloCategoriaResolvida(l) {
    if (!l.categoriaResolvida) return '';
    return typeof l.categoriaResolvida === 'object' ? `__nova__` : l.categoriaResolvida;
}

function _renderLinhaImportCSV(l, i, comCheckboxPular = false, comCheckboxIgnorar = false) {
    const pronta = _linhaPronta(l);
    const metodos = (estadoApp.menus && estadoApp.menus.metodos) || [];
    const categorias = l.tipo === 'entradas'
        ? (estadoApp.menus.categoriasReceita || [])
        : (estadoApp.menus.categoriasDespesa || []);
    const nomeNovaCategoria = (l.categoriaResolvida && typeof l.categoriaResolvida === 'object')
        ? l.categoriaResolvida.nome : l.categoriaCSV;

    return `
    <tr class="${pronta ? '' : 'import-csv-linha-revisar'}">
        ${comCheckboxPular ? `<td><input type="checkbox" data-import-pular-dup="${i}" ${l.pularDuplicata ? 'checked' : ''}></td>` : ''}
        ${comCheckboxIgnorar ? `<td><input type="checkbox" data-import-ignorar="${i}" title="Não importar esta linha" ${l.ignorarManual ? 'checked' : ''}></td>` : ''}
        <td>${l.dataISO ? l.dataISO.split('-').reverse().join('/') : '?'}</td>
        <td>${formatarMoeda(l.valor)}</td>
        <td><span class="chip-tipo chip-tipo--${l.tipo}">${l.tipo === 'entradas' ? 'Receita' : 'Despesa'}</span></td>
        <td>
            <select data-import-metodo="${i}">
                <option value="">Selecione...</option>
                ${metodos.map(m => {
                    const rot = rotuloMetodo(m);
                    return `<option value="${rot}" ${l.metodoResolvido === rot ? 'selected' : ''}>${rot}</option>`;
                }).join('')}
            </select>
        </td>
        <td>
            <select data-import-categoria="${i}">
                <option value="">Selecione...</option>
                ${categorias.map(c => `<option value="${c}" ${_rotuloCategoriaResolvida(l) === c ? 'selected' : ''}>${c}</option>`).join('')}
                ${l.categoriaCSV ? `<option value="__nova__" ${_rotuloCategoriaResolvida(l) === '__nova__' ? 'selected' : ''}>+ criar categoria "${l.categoriaCSV}"</option>` : ''}
            </select>
        </td>
        <td class="import-csv-desc" title="${l.descricao}">${l.descricao || '<span class="import-csv-tag-original">' + l.categoriaCSV + '</span>'}</td>
    </tr>`;
}

/* ---------- Eventos ---------- */

/** Mês/ano mais comum entre as datas completas do arquivo — usado só pra
 *  pré-preencher "Mês de competência" quando a coluna Data já veio
 *  completa (não tem "dia + corte" pra advinhar, então não tem por que
 *  deixar o campo vazio esperando o usuário digitar o óbvio). O usuário
 *  ainda pode trocar se o mês sugerido não for o que ele queria gravar. */
function _competenciaSugeridaDeDataCompleta(linhas) {
    const contagem = new Map();
    linhas.forEach(l => {
        if (!l.dataCompletaISO) return;
        const chave = l.dataCompletaISO.slice(0, 7); // 'YYYY-MM'
        contagem.set(chave, (contagem.get(chave) || 0) + 1);
    });
    if (!contagem.size) return null;
    const [maisComum] = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0];
    const [ano, mes] = maisComum.split('-').map(Number);
    return { mes, ano };
}

function onImportCsvArquivoEscolhido(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const linhas = _parsearArquivoImport(String(reader.result || ''));
        if (!linhas.length) {
            mostrarNotificacao('Não achei linhas válidas nesse CSV', 'erro');
            return;
        }
        const todasComDataCompleta = linhas.every(l => l.dataCompletaISO);
        const anoAtual = new Date().getFullYear();
        const sugestao = todasComDataCompleta ? _competenciaSugeridaDeDataCompleta(linhas) : null;
        estadoImportCSV = {
            linhas,
            competenciaMes: sugestao ? sugestao.mes : null,
            competenciaAno: sugestao ? sugestao.ano : anoAtual,
            competenciaISO: sugestao ? `${sugestao.ano}-${String(sugestao.mes).padStart(2, '0')}-01` : null,
            corte: null
        };
        _recomputarImportCSV({ refazerDuplicatas: true });
    };
    reader.readAsText(file, 'utf-8');
}

async function onImportCsvConfirmar() {
    const st = estadoImportCSV;
    if (!st) return;
    const prontas = st.linhas.filter(_linhaPronta);
    if (!prontas.length) return;

    const btn = document.getElementById('importCsvConfirmar');
    const barra = document.getElementById('importCsvProgresso');
    if (btn) btn.disabled = true;
    if (barra) barra.hidden = false;

    // Cria, uma vez cada, as categorias novas confirmadas na revisão — checa
    // tanto contra o que já está cadastrado (evita recriar algo que já existe,
    // por já ter sido criado numa importação anterior) quanto contra as que
    // este mesmo lote já está criando.
    const novasCategorias = new Set(); // "tipo|nome" -> já criada neste lote
    for (const l of prontas) {
        if (l.categoriaResolvida && typeof l.categoriaResolvida === 'object') {
            const nome = l.categoriaResolvida.nome;
            const chave = `${l.tipo}|${nome}`;
            const jaExiste = _melhorMatch(nome, l.tipo === 'entradas'
                ? (estadoApp.menus.categoriasReceita || [])
                : (estadoApp.menus.categoriasDespesa || []), c => c);
            if (!novasCategorias.has(chave) && !jaExiste) {
                novasCategorias.add(chave);
                await adicionarItemMenuAPI('Categoria', nome, { categoria_tipo: l.tipo });
            }
        }
    }

    let ok = 0, falhas = 0;
    for (let i = 0; i < prontas.length; i++) {
        const l = prontas[i];
        if (barra) barra.textContent = `Importando ${i + 1} de ${prontas.length}...`;
        const categoriaFinal = typeof l.categoriaResolvida === 'object' ? l.categoriaResolvida.nome : l.categoriaResolvida;
        try {
            await adicionarTransacaoAPI({
                tipo: l.tipo,
                data: l.dataISO,
                valor: l.valor,
                metodo: l.metodoResolvido,
                categoria: categoriaFinal,
                descricao: l.descricao,
                formaPagamento: 'À vista',
                tipoRecorrencia: 'Pontual',
                diaRecorrencia: '',
                diaSemana: '',
                semanas: [],
                competencia: st.competenciaISO
            });
            ok++;
        } catch (err) {
            console.error('Erro ao importar linha', l, err);
            falhas++;
        }
    }

    if (barra) barra.hidden = true;
    estadoImportCSV = null;

    if (typeof recarregarMenus === 'function') await recarregarMenus();
    if (typeof recarregarDados === 'function') await recarregarDados();
    if (typeof atualizarUI === 'function') atualizarUI();

    mostrarNotificacao(
        falhas ? `${ok} lançamentos importados, ${falhas} falharam` : `${ok} lançamentos importados com sucesso!`,
        falhas ? 'erro' : 'sucesso'
    );
    renderImportCSV();
}
