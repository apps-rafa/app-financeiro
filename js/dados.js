/**
 * DADOS
 * Backup (baixar tudo em JSON) e apagar tudo — sub-aba "Dados" em
 * Configurações. A restauração do backup fica em Importar > Backup, mais
 * abaixo neste arquivo.
 */

function iniciarDados() {
    const sec = document.getElementById('secDados');
    if (!sec) return;
    renderDados();
}

// Seleção pra backup/apagar PARCIAL (em vez de tudo). Meses é a única
// seleção granular (item por item — faz sentido escolher SÓ setembro);
// categorias/formas/feriados são um toggle único pro grupo inteiro (não
// item por item — são metadado de configuração, não dá pra "apagar só a
// categoria Mercado" por essa tela). Persiste enquanto a aba fica aberta
// (module-local, não salva no banco).
const _selecaoDados = { meses: new Set(), categorias: false, formas: false, feriados: false };

function renderDados() {
    const sec = document.getElementById('secDados');
    if (!sec) return;
    sec.innerHTML = `
    <p class="menu-hint">
        Baixe uma cópia de tudo que você já lançou (lançamentos, categorias, formas de pagamento, recorrências) num arquivo
        de backup — dá pra restaurar depois em Importar &gt; Backup. Ou apague tudo e comece do zero.
    </p>
    <div class="dados-acoes">
        <button type="button" class="btn-submit" id="btnBaixarBackup">⬇️ Baixar backup</button>
        <button type="button" class="mini-btn armed" id="btnAbrirApagarTudo">🗑 Apagar tudo</button>
    </div>
    <div id="dadosStatus" class="import-csv-progresso" hidden></div>

    <h3 class="dados-selecao-titulo">Ou escolha só uma parte</h3>
    <p class="menu-hint">
        Marque meses, categorias e/ou formas de pagamento pra restringir o backup/apagar a só isso
        (grupo sem nada marcado = não filtra por ele). Feriados entram só se marcar a caixinha.
    </p>
    <div id="dadosSelecaoConteudo"></div>
    <div class="dados-acoes">
        <button type="button" class="btn-submit" id="btnBaixarBackupSelecao">⬇️ Baixar backup da seleção</button>
        <button type="button" class="mini-btn armed" id="btnApagarSelecao">🗑 Apagar seleção</button>
    </div>
    <div id="dadosSelecaoStatus" class="import-csv-progresso" hidden></div>
    `;
    document.getElementById('btnBaixarBackup')?.addEventListener('click', baixarBackup);
    document.getElementById('btnAbrirApagarTudo')?.addEventListener('click', confirmarApagarTudoDados);
    document.getElementById('btnBaixarBackupSelecao')?.addEventListener('click', baixarBackupSelecao);
    document.getElementById('btnApagarSelecao')?.addEventListener('click', confirmarApagarSelecao);
    _renderSelecaoDados();
}

/** Meses (YYYY-MM) que têm pelo menos 1 lançamento — só esses aparecem
 *  como opção, não tem por que oferecer um mês vazio pra selecionar. */
async function _mesesComLancamento() {
    const { data, error } = await sb.from('transacoes').select('data');
    if (error) { console.error('Erro ao listar meses:', error); return []; }
    const set = new Set();
    (data || []).forEach(r => { if (r.data) set.add(String(r.data).slice(0, 7)); });
    return [...set].sort().reverse(); // mais recente primeiro
}

async function _renderSelecaoDados() {
    const cont = document.getElementById('dadosSelecaoConteudo');
    if (!cont) return;
    cont.innerHTML = `<p class="menu-hint">Carregando...</p>`;

    const meses = await _mesesComLancamento();

    const grupoMeses = !meses.length ? '' : `
    <details class="fer-grupo" open>
      <summary><span class="fer-grupo-nome">Meses</span><span class="fer-grupo-contagem">${meses.length}</span></summary>
      <div class="menu-list dados-selecao-lista">${meses.map(m => {
          const [ano, mes] = m.split('-').map(Number);
          const rotulo = obterMesAnoCurto(new Date(ano, mes - 1, 1));
          return `<label class="dados-selecao-item"><input type="checkbox" data-selecao-mes value="${m}" ${_selecaoDados.meses.has(m) ? 'checked' : ''}> ${rotulo}</label>`;
      }).join('')}</div>
    </details>`;

    // Categorias/formas/feriados são um toggle SÓ do grupo inteiro (não item
    // por item) — são metadado de configuração, não faz sentido "escolher
    // só a categoria Mercado" nessa tela.
    cont.innerHTML = `
    ${grupoMeses}
    <label class="dados-selecao-item">
        <input type="checkbox" id="dadosSelecaoCategorias" ${_selecaoDados.categorias ? 'checked' : ''}> Categorias
    </label>
    <label class="dados-selecao-item">
        <input type="checkbox" id="dadosSelecaoFormas" ${_selecaoDados.formas ? 'checked' : ''}> Formas de pagamento
    </label>
    <label class="dados-selecao-item">
        <input type="checkbox" id="dadosSelecaoFeriados" ${_selecaoDados.feriados ? 'checked' : ''}>
        Feriados cadastrados (municipais/avulsos e estaduais sincronizados)
    </label>
    `;

    cont.querySelectorAll('[data-selecao-mes]').forEach(chk => {
        chk.addEventListener('change', e => {
            if (e.target.checked) _selecaoDados.meses.add(e.target.value); else _selecaoDados.meses.delete(e.target.value);
        });
    });
    document.getElementById('dadosSelecaoCategorias')?.addEventListener('change', e => { _selecaoDados.categorias = e.target.checked; });
    document.getElementById('dadosSelecaoFormas')?.addEventListener('change', e => { _selecaoDados.formas = e.target.checked; });
    document.getElementById('dadosSelecaoFeriados')?.addEventListener('change', e => { _selecaoDados.feriados = e.target.checked; });
}

/** true se a transação bate com a seleção atual (só meses filtra transação —
 *  categorias/formas/feriados são toggle de metadado, ver acima). */
function _transacaoNaSelecaoDados(t) {
    return !_selecaoDados.meses.size || _selecaoDados.meses.has(String(t.data).slice(0, 7));
}

function _nadaSelecionadoDados() {
    return !_selecaoDados.meses.size && !_selecaoDados.categorias && !_selecaoDados.formas && !_selecaoDados.feriados;
}

async function baixarBackupSelecao() {
    if (_nadaSelecionadoDados()) { mostrarNotificacao('Marque pelo menos um mês, categoria, forma de pagamento ou feriados', 'erro'); return; }
    const status = document.getElementById('dadosSelecaoStatus');
    if (status) { status.hidden = false; status.textContent = 'Gerando backup da seleção...'; }
    try {
        const [{ data: todasTrans, error: e1 }, { data: menuItens, error: e2 }, { data: feriadosRows, error: e3 }] = await Promise.all([
            sb.from('transacoes').select('*'),
            sb.from('menu_itens').select('*'),
            sb.from('feriados').select('*')
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        if (e3) throw e3;

        const transacoes = (todasTrans || []).filter(_transacaoNaSelecaoDados);
        // Categoria/Método só entram se o toggle do grupo tiver marcado.
        // Recorrência (sem toggle próprio) sempre entra inteira.
        const menuItensFiltrados = (menuItens || []).filter(m => {
            if (m.tipo === 'Categoria') return _selecaoDados.categorias;
            if (m.tipo === 'Método') return _selecaoDados.formas;
            return true;
        });
        const feriadosFinal = _selecaoDados.feriados ? (feriadosRows || []) : [];

        const backup = {
            versao: 1,
            app: 'Ctrl Financeiro',
            exportadoEm: new Date().toISOString(),
            selecaoParcial: true,
            transacoes,
            menuItens: menuItensFiltrados,
            feriados: feriadosFinal
        };

        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup-parcial-ctrl-financeiro-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        mostrarNotificacao(`Backup da seleção baixado! ${transacoes.length} lançamentos, ${menuItensFiltrados.length} itens de configuração, ${feriadosFinal.length} feriados.`, 'sucesso');
    } catch (err) {
        console.error('Erro ao gerar backup da seleção:', err);
        mostrarNotificacao('Erro ao gerar backup da seleção', 'erro');
    } finally {
        if (status) status.hidden = true;
    }
}

async function confirmarApagarSelecao() {
    if (_nadaSelecionadoDados()) { mostrarNotificacao('Marque pelo menos um mês, categorias, formas de pagamento ou feriados', 'erro'); return; }
    const status = document.getElementById('dadosSelecaoStatus');
    if (status) { status.hidden = false; status.textContent = 'Conferindo o que bate com a seleção...'; }
    // Transação só entra se MESES estiver marcado — categorias/formas/
    // feriados abaixo são toggle de metadado, não filtram lançamento.
    let alvo = [];
    try {
        if (_selecaoDados.meses.size) {
            const { data, error } = await sb.from('transacoes').select('id, data');
            if (error) throw error;
            alvo = (data || []).filter(_transacaoNaSelecaoDados);
        }
    } catch (err) {
        console.error('Erro ao conferir seleção:', err);
        mostrarNotificacao('Erro ao conferir a seleção', 'erro');
        return;
    } finally {
        if (status) status.hidden = true;
    }

    const { categorias: apagaCategorias, formas: apagaFormas, feriados: apagaFeriados } = _selecaoDados;
    if (!alvo.length && !apagaCategorias && !apagaFormas && !apagaFeriados) {
        mostrarNotificacao('Nada bateu com essa seleção', 'erro');
        return;
    }

    const partes = [];
    if (alvo.length) partes.push(`${alvo.length} lançamento${alvo.length === 1 ? '' : 's'}`);
    if (apagaCategorias) partes.push('todas as categorias');
    if (apagaFormas) partes.push('todas as formas de pagamento');
    if (apagaFeriados) partes.push('os feriados cadastrados (municipais/avulsos e estaduais sincronizados)');

    mostrarDialogo({
        titulo: 'Apagar seleção?',
        texto: `Remove ${partes.join(', ')}. Não dá para desfazer.`,
        acoes: [
            { label: 'Cancelar' },
            { label: 'Apagar seleção', primario: true, perigo: true, onClick: async () => {
                try {
                    const ids = alvo.map(t => t.id);
                    for (let i = 0; i < ids.length; i += 200) {
                        const lote = ids.slice(i, i + 200);
                        const { error } = await sb.from('transacoes').delete().in('id', lote);
                        if (error) throw error;
                    }
                    if (apagaCategorias) {
                        const { error } = await sb.from('menu_itens').delete().eq('tipo', 'Categoria');
                        if (error) throw error;
                    }
                    if (apagaFormas) {
                        const { error } = await sb.from('menu_itens').delete().eq('tipo', 'Método');
                        if (error) throw error;
                    }
                    if (apagaFeriados) {
                        const { error } = await sb.from('feriados').delete().gte('id', 0);
                        if (error) throw error;
                    }
                    mostrarNotificacao('Seleção apagada', 'sucesso');
                    if (typeof recarregarMenus === 'function') await recarregarMenus();
                    if (typeof recarregarDados === 'function') await recarregarDados();
                    _renderSelecaoDados();
                } catch (err) {
                    console.error('Erro ao apagar seleção:', err);
                    mostrarNotificacao('Erro ao apagar seleção', 'erro');
                }
            } }
        ]
    });
}

async function baixarBackup() {
    const status = document.getElementById('dadosStatus');
    if (status) { status.hidden = false; status.textContent = 'Gerando backup...'; }
    try {
        const [{ data: transacoes, error: e1 }, { data: menuItens, error: e2 }, { data: feriados, error: e3 }] = await Promise.all([
            sb.from('transacoes').select('*'),
            sb.from('menu_itens').select('*'),
            sb.from('feriados').select('*')
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        if (e3) throw e3;

        const backup = {
            versao: 1,
            app: 'Ctrl Financeiro',
            exportadoEm: new Date().toISOString(),
            transacoes: transacoes || [],
            menuItens: menuItens || [],
            feriados: feriados || []
        };

        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup-ctrl-financeiro-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        mostrarNotificacao(`Backup baixado! ${backup.transacoes.length} lançamentos, ${backup.menuItens.length} itens de configuração, ${backup.feriados.length} feriados.`, 'sucesso');
    } catch (err) {
        console.error('Erro ao gerar backup:', err);
        mostrarNotificacao('Erro ao gerar backup', 'erro');
    } finally {
        if (status) status.hidden = true;
    }
}

function confirmarApagarTudoDados() {
    mostrarDialogo({
        titulo: 'Apagar tudo?',
        texto: 'Remove <strong>todos os seus lançamentos e itens de configuração</strong> (categorias, formas de pagamento, recorrências, feriados). Não dá para desfazer — baixe um backup antes se quiser guardar seus dados.',
        acoes: [
            { label: 'Cancelar' },
            { label: 'Apagar tudo', primario: true, perigo: true, onClick: async () => {
                try {
                    await sb.from('transacoes').delete().gte('id', 0);
                    await sb.from('menu_itens').delete().gte('id', 0);
                    await sb.from('feriados').delete().gte('id', 0);
                    mostrarNotificacao('Tudo apagado', 'sucesso');
                    setTimeout(() => location.reload(), 400);
                } catch (err) {
                    console.error('Erro ao apagar tudo:', err);
                    mostrarNotificacao('Erro ao apagar', 'erro');
                }
            } }
        ]
    });
}

/* ================= Importar > Backup (restaurar) ================= */

let estadoImportarBackup = null;

function iniciarImportarBackup() {
    const sec = document.getElementById('secImportarBackup');
    if (!sec) return;
    estadoImportarBackup = null;
    renderImportarBackup();
}

function renderImportarBackup() {
    const sec = document.getElementById('secImportarBackup');
    if (!sec) return;

    if (!estadoImportarBackup) {
        sec.innerHTML = `
        <p class="menu-hint">
            Restaura um arquivo baixado em Configurações &gt; Dados. Isso <b>adiciona</b> os dados do backup por
            cima do que já existe — pra uma restauração limpa, apague tudo antes em Configurações &gt; Dados.
        </p>
        <div class="import-csv-upload">
            <input type="file" id="importBackupArquivo" accept=".json,application/json">
            <label class="import-csv-upload-label" for="importBackupArquivo">📁 Escolher arquivo</label>
        </div>`;
        document.getElementById('importBackupArquivo')?.addEventListener('change', onBackupArquivoEscolhido);
        return;
    }

    const b = estadoImportarBackup;
    const dataFormatada = b.exportadoEm ? new Date(b.exportadoEm).toLocaleString('pt-BR') : '?';
    const feriados = Array.isArray(b.feriados) ? b.feriados : [];
    sec.innerHTML = `
    <p class="import-csv-resumo">
        Backup${b.selecaoParcial ? ' PARCIAL (uma seleção, não tudo)' : ''} de ${dataFormatada} — <b>${b.menuItens.length}</b> itens de configuração,
        <b>${b.transacoes.length}</b> lançamentos, <b>${feriados.length}</b> feriados
    </p>
    <div class="import-csv-acoes">
        <button type="button" class="btn-submit" id="btnRestaurarBackup">Restaurar backup</button>
        <button type="button" class="mini-btn" id="btnCancelarBackup">Cancelar</button>
    </div>
    <div id="importBackupProgresso" class="import-csv-progresso" hidden></div>
    `;
    document.getElementById('btnRestaurarBackup')?.addEventListener('click', onRestaurarBackup);
    document.getElementById('btnCancelarBackup')?.addEventListener('click', () => {
        estadoImportarBackup = null;
        renderImportarBackup();
    });
}

function onBackupArquivoEscolhido(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const json = JSON.parse(String(reader.result || ''));
            if (!json || !Array.isArray(json.transacoes) || !Array.isArray(json.menuItens)) {
                throw new Error('esse arquivo não parece um backup válido');
            }
            estadoImportarBackup = json;
            renderImportarBackup();
        } catch (err) {
            console.error('Erro ao ler backup:', err);
            mostrarNotificacao('Não consegui ler esse backup: ' + err.message, 'erro');
        }
    };
    reader.readAsText(file, 'utf-8');
}

async function onRestaurarBackup() {
    const b = estadoImportarBackup;
    if (!b) return;

    const btn = document.getElementById('btnRestaurarBackup');
    const barra = document.getElementById('importBackupProgresso');
    if (btn) btn.disabled = true;
    if (barra) { barra.hidden = false; barra.textContent = 'Restaurando itens de configuração...'; }

    try {
        const menuLimpos = b.menuItens.map(({ id, user_id, criado_em, ...resto }) => resto);
        if (menuLimpos.length) {
            const { error } = await sb.from('menu_itens').insert(menuLimpos);
            if (error) throw error;
        }

        // grupo_id (séries recorrentes) aponta pro id ANTIGO da própria
        // transação-base do grupo — não dá pra inserir direto (o id vai
        // mudar). Insere sem grupo_id, guarda o mapa id-antigo -> id-novo,
        // e corrige as referências numa 2ª passada.
        const transPreparadas = b.transacoes.map(t => {
            const { id, user_id, criado_em, grupo_id, ...resto } = t;
            return { _oldId: id, _oldGrupoId: grupo_id, dados: resto };
        });

        const idMap = new Map();
        const TAMANHO_LOTE = 200;
        for (let i = 0; i < transPreparadas.length; i += TAMANHO_LOTE) {
            const lote = transPreparadas.slice(i, i + TAMANHO_LOTE);
            const { data, error } = await sb.from('transacoes').insert(lote.map(l => l.dados)).select('id');
            if (error) throw error;
            data.forEach((row, idx) => idMap.set(lote[idx]._oldId, row.id));
            if (barra) barra.textContent = `Restaurando lançamentos (${Math.min(i + TAMANHO_LOTE, transPreparadas.length)}/${transPreparadas.length})...`;
        }

        const comGrupo = transPreparadas.filter(l => l._oldGrupoId != null && idMap.has(l._oldGrupoId));
        for (const l of comGrupo) {
            await sb.from('transacoes').update({ grupo_id: idMap.get(l._oldGrupoId) }).eq('id', idMap.get(l._oldId));
        }

        const feriados = Array.isArray(b.feriados) ? b.feriados : [];
        const feriadosLimpos = feriados.map(({ id, user_id, created_at, ...resto }) => resto);
        if (feriadosLimpos.length) {
            const { error } = await sb.from('feriados').insert(feriadosLimpos);
            if (error) throw error;
        }

        mostrarNotificacao(`Backup restaurado! ${b.menuItens.length} itens de configuração, ${b.transacoes.length} lançamentos, ${feriadosLimpos.length} feriados.`, 'sucesso');
        estadoImportarBackup = null;
        if (typeof recarregarMenus === 'function') await recarregarMenus();
        if (typeof recarregarDados === 'function') await recarregarDados();
        renderImportarBackup();
    } catch (err) {
        console.error('Erro ao restaurar backup:', err);
        mostrarNotificacao('Erro ao restaurar backup', 'erro');
    } finally {
        if (btn) btn.disabled = false;
        if (barra) barra.hidden = true;
    }
}
