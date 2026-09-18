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

// Categorias/formas de pagamento/feriados: só entram no backup/apagar (e só
// os lançamentos entram no apagar) conforme esses 3 botões-toggle — nada
// marcado = nada pra fazer (botões de ação ficam desativados). Persiste
// enquanto a aba fica aberta (module-local, não salva no banco).
const _dadosIncluir = { categorias: false, formas: false, feriados: false };

/** Contagens pra mostrar junto de cada botão-toggle marcado. */
async function _contagemDados() {
    const [catReceita, catDespesa, formas, feriados] = await Promise.all([
        sb.from('menu_itens').select('id', { count: 'exact', head: true }).eq('tipo', 'Categoria').eq('categoria_tipo', 'entradas'),
        sb.from('menu_itens').select('id', { count: 'exact', head: true }).eq('tipo', 'Categoria').neq('categoria_tipo', 'entradas'),
        sb.from('menu_itens').select('id', { count: 'exact', head: true }).eq('tipo', 'Método'),
        sb.from('feriados').select('id', { count: 'exact', head: true })
    ]);
    return {
        catReceita: catReceita.count || 0,
        catDespesa: catDespesa.count || 0,
        formas: formas.count || 0,
        feriados: feriados.count || 0
    };
}

async function renderDados() {
    const sec = document.getElementById('secDados');
    if (!sec) return;
    sec.innerHTML = `
    <p class="menu-hint">
        Baixe uma cópia de tudo que você já lançou num arquivo de backup — dá pra restaurar depois em Importar &gt; Backup.
    </p>
    <div class="modo-lista dados-incluir">
        <button type="button" class="modo-btn" data-dados-incluir="categorias"><span class="dados-incluir-check">✓</span> Categorias</button>
        <button type="button" class="modo-btn" data-dados-incluir="formas"><span class="dados-incluir-check">✓</span> Formas de pagamento</button>
        <button type="button" class="modo-btn" data-dados-incluir="feriados"><span class="dados-incluir-check">✓</span> Feriados cadastrados</button>
    </div>
    <p class="menu-hint" id="dadosContagem"></p>
    <div class="dados-acoes">
        <button type="button" class="btn-submit" id="btnBaixarBackup">⬇️ Baixar backup</button>
        <button type="button" class="mini-btn armed" id="btnApagarDados">🗑 Apagar</button>
    </div>
    <div id="dadosStatus" class="import-csv-progresso" hidden></div>
    `;

    const contagem = await _contagemDados();

    const atualizar = () => {
        sec.querySelectorAll('[data-dados-incluir]').forEach(btn => {
            btn.classList.toggle('active', _dadosIncluir[btn.dataset.dadosIncluir]);
        });
        const algumaSelecionada = _dadosIncluir.categorias || _dadosIncluir.formas || _dadosIncluir.feriados;
        const btnBackup = document.getElementById('btnBaixarBackup');
        const btnApagar = document.getElementById('btnApagarDados');
        if (btnBackup) btnBackup.disabled = !algumaSelecionada;
        if (btnApagar) btnApagar.disabled = !algumaSelecionada;

        const frases = [];
        if (_dadosIncluir.categorias) frases.push(`${contagem.catReceita} categoria(s) de receita, ${contagem.catDespesa} categoria(s) de despesa`);
        if (_dadosIncluir.formas) frases.push(`${contagem.formas} forma(s) de pagamento`);
        if (_dadosIncluir.feriados) frases.push(`${contagem.feriados} feriado(s)`);
        const contagemEl = document.getElementById('dadosContagem');
        if (contagemEl) contagemEl.textContent = frases.length ? frases.join('. ') + '.' : 'Marque o que você quer baixar ou apagar.';
    };

    sec.querySelectorAll('[data-dados-incluir]').forEach(btn => {
        const chave = btn.dataset.dadosIncluir;
        btn.addEventListener('click', () => {
            _dadosIncluir[chave] = !_dadosIncluir[chave];
            atualizar();
        });
    });
    atualizar();

    document.getElementById('btnBaixarBackup')?.addEventListener('click', baixarBackup);
    document.getElementById('btnApagarDados')?.addEventListener('click', confirmarApagarDados);
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

        const menuItensFiltrados = (menuItens || []).filter(m => {
            if (m.tipo === 'Categoria') return _dadosIncluir.categorias;
            if (m.tipo === 'Método') return _dadosIncluir.formas;
            return true;
        });
        const feriadosFinal = _dadosIncluir.feriados ? (feriados || []) : [];

        const backup = {
            versao: 1,
            app: 'Ctrl Financeiro',
            exportadoEm: new Date().toISOString(),
            transacoes: transacoes || [],
            menuItens: menuItensFiltrados,
            feriados: feriadosFinal
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

        mostrarNotificacao(`Backup baixado! ${backup.transacoes.length} lançamentos, ${menuItensFiltrados.length} itens de configuração, ${feriadosFinal.length} feriados.`, 'sucesso');
    } catch (err) {
        console.error('Erro ao gerar backup:', err);
        mostrarNotificacao('Erro ao gerar backup', 'erro');
    } finally {
        if (status) status.hidden = true;
    }
}

function confirmarApagarDados() {
    const { categorias, formas, feriados } = _dadosIncluir;
    if (!categorias && !formas && !feriados) return;
    const partes = [];
    if (categorias) partes.push('categorias');
    if (formas) partes.push('formas de pagamento');
    if (feriados) partes.push('feriados cadastrados');

    mostrarDialogo({
        titulo: 'Apagar?',
        texto: `Remove <strong>${partes.join(', ')}</strong>. Não dá para desfazer — baixe um backup antes se quiser guardar seus dados.`,
        acoes: [
            { label: 'Cancelar' },
            { label: 'Apagar', primario: true, perigo: true, onClick: async () => {
                try {
                    if (categorias) await sb.from('menu_itens').delete().eq('tipo', 'Categoria');
                    if (formas) await sb.from('menu_itens').delete().eq('tipo', 'Método');
                    if (feriados) await sb.from('feriados').delete().gte('id', 0);
                    mostrarNotificacao('Apagado', 'sucesso');
                    setTimeout(() => location.reload(), 400);
                } catch (err) {
                    console.error('Erro ao apagar:', err);
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
