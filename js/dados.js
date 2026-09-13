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

function renderDados() {
    const sec = document.getElementById('secDados');
    if (!sec) return;
    sec.innerHTML = `
    <h3>💾 Dados</h3>
    <p class="menu-hint">
        Baixe uma cópia de tudo que você já lançou (lançamentos, categorias, métodos, recorrências) num arquivo
        de backup — dá pra restaurar depois em Importar &gt; Backup. Ou apague tudo e comece do zero.
    </p>
    <div class="dados-acoes">
        <button type="button" class="btn-submit" id="btnBaixarBackup">⬇️ Baixar backup</button>
        <button type="button" class="mini-btn armed" id="btnAbrirApagarTudo">🗑 Apagar tudo</button>
    </div>
    <div id="dadosStatus" class="import-csv-progresso" hidden></div>
    `;
    document.getElementById('btnBaixarBackup')?.addEventListener('click', baixarBackup);
    document.getElementById('btnAbrirApagarTudo')?.addEventListener('click', confirmarApagarTudoDados);
}

async function baixarBackup() {
    const status = document.getElementById('dadosStatus');
    if (status) { status.hidden = false; status.textContent = 'Gerando backup...'; }
    try {
        const [{ data: transacoes, error: e1 }, { data: menuItens, error: e2 }] = await Promise.all([
            sb.from('transacoes').select('*'),
            sb.from('menu_itens').select('*')
        ]);
        if (e1) throw e1;
        if (e2) throw e2;

        const backup = {
            versao: 1,
            app: 'Ctrl Financeiro',
            exportadoEm: new Date().toISOString(),
            transacoes: transacoes || [],
            menuItens: menuItens || []
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

        mostrarNotificacao(`Backup baixado! ${backup.transacoes.length} lançamentos, ${backup.menuItens.length} itens de configuração.`, 'sucesso');
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
        texto: 'Remove <strong>todos os seus lançamentos e itens de configuração</strong> (categorias, métodos, recorrências, feriados). Não dá para desfazer — baixe um backup antes se quiser guardar seus dados.',
        acoes: [
            { label: 'Cancelar' },
            { label: 'Apagar tudo', primario: true, perigo: true, onClick: async () => {
                try {
                    await sb.from('transacoes').delete().gte('id', 0);
                    await sb.from('menu_itens').delete().gte('id', 0);
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
        </div>`;
        document.getElementById('importBackupArquivo')?.addEventListener('change', onBackupArquivoEscolhido);
        return;
    }

    const b = estadoImportarBackup;
    const dataFormatada = b.exportadoEm ? new Date(b.exportadoEm).toLocaleString('pt-BR') : '?';
    sec.innerHTML = `
    <p class="import-csv-resumo">
        Backup de ${dataFormatada} — <b>${b.menuItens.length}</b> itens de configuração,
        <b>${b.transacoes.length}</b> lançamentos
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

        mostrarNotificacao(`Backup restaurado! ${b.menuItens.length} itens de configuração, ${b.transacoes.length} lançamentos.`, 'sucesso');
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
