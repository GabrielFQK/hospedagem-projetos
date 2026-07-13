// POST /api/upload  (precisa do cookie de sessão válido) — recebe versão,
// changelog, link de download e texto do botão (do projeto existente ou de
// um novo) e reescreve projetos.json direto no GitHub via API (sem git
// local nenhum). O binário (.exe/.zip) NÃO passa por aqui — você sobe ele
// manualmente numa GitHub Release e só cola o link.
const { sessaoValida, githubApi } = require('./_util');

function gerarId(nome) {
    // normaliza (separa letra + acento) e descarta qualquer caractere que
    // não seja letra/número comum — remove os acentos junto (mais simples e
    // sem depender de range Unicode escrito à mão no regex, que varia
    // conforme o encoding do arquivo)
    return nome
        .toLowerCase()
        .normalize('NFD')
        .split('')
        .filter(c => c.charCodeAt(0) < 0x300 || c.charCodeAt(0) > 0x36f)
        .join('')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }
    if (!sessaoValida(event)) {
        return { statusCode: 401, body: JSON.stringify({ erro: 'Sessão inválida ou expirada, faça login de novo.' }) };
    }

    let dados;
    try {
        dados = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, body: JSON.stringify({ erro: 'JSON inválido' }) };
    }

    const { acao, versao, mudancas, linkDownload, rotuloBotao, marcarNovo } = dados;
    if (!versao || !Array.isArray(mudancas) || mudancas.length === 0 || !linkDownload || !rotuloBotao) {
        return { statusCode: 400, body: JSON.stringify({ erro: 'Preencha versão, changelog, link e texto do botão.' }) };
    }

    const caminhoArquivo = process.env.GITHUB_PROJETOS_PATH || 'projetos.json';
    const branch = process.env.GITHUB_BRANCH || 'main';

    // 1) lê o projetos.json atual — precisa do "sha" dele pra poder
    // sobrescrever (é assim que a API do GitHub evita sobrescrever por
    // cima de uma mudança concorrente sem querer)
    const respostaAtual = await githubApi(`/contents/${encodeURIComponent(caminhoArquivo)}?ref=${branch}`);
    if (!respostaAtual.ok) {
        return { statusCode: 502, body: JSON.stringify({ erro: 'Não consegui ler projetos.json no GitHub.' }) };
    }
    const atual = await respostaAtual.json();
    const conteudoAtual = JSON.parse(Buffer.from(atual.content, 'base64').toString('utf-8'));
    const projetos = conteudoAtual.projetos || [];

    const novaVersao = { versao, mudancas };
    let idAtivo;

    if (acao === 'criar') {
        const { nome, tipo, descricao } = dados;
        if (!nome || !tipo || !descricao) {
            return { statusCode: 400, body: JSON.stringify({ erro: 'Faltou nome, tipo ou descrição do novo projeto.' }) };
        }
        const id = gerarId(nome);
        if (!id || projetos.some(p => p.id === id)) {
            return { statusCode: 400, body: JSON.stringify({ erro: 'Já existe um projeto com esse nome (ou nome inválido).' }) };
        }
        projetos.push({
            id, nome, tipo, descricao,
            versaoAtual: versao,
            linkDownload, rotuloBotao,
            novo: !!marcarNovo,
            emConstrucao: false,
            historico: [novaVersao],
        });
        idAtivo = id;
    } else {
        const projeto = projetos.find(p => p.id === dados.projetoId);
        if (!projeto) {
            return { statusCode: 400, body: JSON.stringify({ erro: 'Projeto não encontrado.' }) };
        }
        projeto.versaoAtual = versao;
        projeto.linkDownload = linkDownload;
        projeto.rotuloBotao = rotuloBotao;
        projeto.emConstrucao = false;
        projeto.historico = [novaVersao, ...(projeto.historico || [])];
        idAtivo = projeto.id;
    }

    // o selo "Novo!" é exclusivo — só o projeto que acabou de ser
    // publicado fica marcado, os outros perdem o selo automaticamente
    if (marcarNovo) {
        for (const p of projetos) p.novo = p.id === idAtivo;
    }

    const novoConteudo = JSON.stringify({ projetos }, null, 2);
    const respostaCommit = await githubApi(`/contents/${encodeURIComponent(caminhoArquivo)}`, {
        method: 'PUT',
        body: JSON.stringify({
            message: `Atualiza ${idAtivo} para ${versao}`,
            content: Buffer.from(novoConteudo, 'utf-8').toString('base64'),
            sha: atual.sha,
            branch,
        }),
    });

    if (!respostaCommit.ok) {
        const erroTexto = await respostaCommit.text();
        return { statusCode: 502, body: JSON.stringify({ erro: 'Não consegui salvar no GitHub: ' + erroTexto }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, id: idAtivo }) };
};
