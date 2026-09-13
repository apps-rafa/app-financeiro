/**
 * IMPORTAR (unificado)
 * A aba CSV e a aba PDF de "Importar" cada uma tem um único dropdown de
 * formato (obrigatório escolher) em vez de duas seções separadas —
 * dependendo do formato escolhido, monta a tela de criar lançamentos
 * (só existe pra "minha planilha") ou a de conciliar (comparar com o que
 * já está no app), sem nunca misturar CSV com PDF.
 */

function iniciarImportarUnificado() {
    const selCsv = document.getElementById('importCsvFormato');
    const selPdf = document.getElementById('importPdfFormato');

    if (selCsv) {
        selCsv.addEventListener('change', () => _montarImportCSV(selCsv.value));
        _montarImportCSV(selCsv.value);
    }
    if (selPdf) {
        selPdf.addEventListener('change', () => _montarImportPDF(selPdf.value));
        _montarImportPDF(selPdf.value);
    }
}

function _semFormatoEscolhido() {
    return `<p class="menu-hint">Escolha um formato acima pra continuar.</p>`;
}

function _montarImportCSV(formato) {
    const cont = document.getElementById('importCsvConteudo');
    if (!cont) return;

    if (!formato) { cont.innerHTML = _semFormatoEscolhido(); return; }

    if (formato === 'pessoal') {
        cont.innerHTML = `<div id="secImportarCSV"></div>`;
        if (typeof iniciarImportarCSV === 'function') iniciarImportarCSV();
        return;
    }

    cont.innerHTML = `<div id="secConciliarCSV"></div>`;
    if (typeof _iniciarConciliar === 'function') {
        _iniciarConciliar('secConciliarCSV', 'csv', formato === 'nubank' ? 'nubank' : 'mp');
    }
}

function _montarImportPDF(formato) {
    const cont = document.getElementById('importPdfConteudo');
    if (!cont) return;

    if (!formato) { cont.innerHTML = _semFormatoEscolhido(); return; }

    cont.innerHTML = `<div id="secConciliarPDF"></div>`;
    if (typeof _iniciarConciliar === 'function') {
        _iniciarConciliar('secConciliarPDF', 'pdf', formato === 'bradesco' ? 'bradesco' : 'mp');
    }
}
